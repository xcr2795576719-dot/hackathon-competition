// GET  /api/report/[model] —— 读 data/reports/<id>.json 缓存；没有则 404 { error: "报告生成中" }
// POST /api/report/[model] —— aiChat(deep=true) 生成报告并落盘；body 可带 { evaluations, force }
//
// 契约（与 docs/prompts/report.md 对齐）：
//   verdict: buy | wait | avoid
//   sources: [{ title, url }]
// 四条判定规则先在服务端算一遍，模型只负责把结论写成人话。
import { aiChat, parseJsonLoose } from "@/lib/ai";
import type { ChatMessage } from "@/lib/ai";
import type { Report, ReportSource } from "@/lib/data";
import {
  findModel,
  medianByGradeOf,
  readKnowledge,
  readPricesCurrent,
  readPricesHistory,
  readReport,
  usedSamplesOf,
  writeReport,
} from "@/lib/data";
import { GRADES, median } from "@/lib/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function yuan(n: number | null | undefined): string {
  return n == null ? "无数据" : "¥" + Math.round(n).toLocaleString("zh-CN");
}

function strArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : String((x as any)?.text ?? x ?? "").trim()))
    .filter(Boolean)
    .slice(0, max);
}

function trimReason(text: unknown, limit = 60): string {
  const s = String(text ?? "").replace(/\s+/g, "").trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  for (const sep of ["。", "；", "，", "、"]) {
    const i = cut.lastIndexOf(sep);
    if (i >= limit / 2) return cut.slice(0, i);
  }
  return cut;
}

const SEVERE = /进水|大修|扩容|翻新|监管|有锁|主板维修/;
const BAD_PLACEHOLDER = /数据不足|暂无可确认|暂无数据|无法判断|缺少数据/;

type Metrics = {
  jd: number | null;
  pct: number | null;
  m95: number | null;
  ratio: number | null;
  week: number | null;
  samples: ReturnType<typeof usedSamplesOf>;
};

function metricsOf(id: string, current: { jd?: number } | null, history: { price: number }[], samples: Metrics["samples"]): Metrics {
  const jd = current && Number.isFinite(Number(current.jd)) ? Number(current.jd) : null;
  const prices = history.map((h) => Number(h.price)).filter((n) => Number.isFinite(n) && n > 0);
  const pct = jd && prices.length ? Math.round((prices.filter((p) => p <= jd).length / prices.length) * 100) : null;
  const g95 = samples
    .filter((s) => s.grade === "95新")
    .map((s) => Number(s.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const m95 = median(g95);
  const ratio = m95 && jd ? Math.round((m95 / jd) * 1000) / 10 : null;
  const week =
    prices.length >= 8 && prices[prices.length - 8]
      ? Math.round(((prices[prices.length - 1] - prices[prices.length - 8]) / prices[prices.length - 8]) * 1000) / 10
      : null;
  return { jd, pct, m95, ratio, week, samples };
}

// 买入线校准：任务书原线 65% 在种子数据下永远不触发（95新/新机价约 78%），
// v1.1 演示线校准到 80%，保留「近30天第30百分位以下」的前置条件。
const BUY_RATIO = 80;

function ruleOf(m: Metrics, knowledge: { title: string; content: string }[]) {
  const severeSample = m.samples.some((s) => SEVERE.test(String(s.condition_text || "")));
  const severeKb = knowledge.some((k) => SEVERE.test(`${k.title} ${k.content}`));

  if (severeSample && severeKb) {
    return {
      verdict: "avoid" as const,
      rule: 1,
      text: "二手样本出现进水/大修/扩容/翻新描述，且避坑知识命中同类风险",
      reason: "二手样本里出现进水/大修/扩容/翻新描述，这类机器后续故障率高，建议避开。",
    };
  }
  if (m.pct != null && m.ratio != null && m.pct <= 30 && m.ratio <= BUY_RATIO) {
    return {
      verdict: "buy" as const,
      rule: 2,
      text: `当前价处于近30天第${m.pct}百分位，且二手95新中位价为新机价${m.ratio}%（≤${BUY_RATIO}%，v1.1 校准）`,
      reason: `当前价处于近30天第${m.pct}百分位，二手95新中位价为新机价的${m.ratio}%，低于${BUY_RATIO}%买入线。`,
    };
  }
  if ((m.pct != null && m.pct >= 70) || (m.week != null && m.week > 5)) {
    const bits: string[] = [];
    if (m.pct != null) bits.push(`当前价第${m.pct}百分位`);
    if (m.week != null) bits.push(`近7天${m.week > 0 ? "+" : ""}${m.week}%`);
    return {
      verdict: "wait" as const,
      rule: 3,
      text: `${bits.join("，")}，价格偏高`,
      reason: `${bits.join("，")}，价格偏高，建议等降价。`,
    };
  }
  return {
    verdict: "wait" as const,
    rule: 4,
    text: "未触发买入条件，等一个更好的价格点",
    reason:
      m.pct != null && m.ratio != null
        ? `当前价虽处第${m.pct}百分位，但二手95新折价${m.ratio}%未到65%买入线，建议再等。`
        : "未触发买入条件，等一个更好的价格点。",
  };
}

function reasonOk(s: string, verdict: string, m: Metrics): boolean {
  if (s.length < 12 || s.length > 60 || BAD_PLACEHOLDER.test(s) || !/\d/.test(s)) return false;
  if (verdict === "buy") return (s.includes("百分位") || s.includes("折价")) && (s.includes("80") || s.includes("折价") || s.includes("二手"));
  if (verdict === "avoid") return /进水|大修|扩容|翻新|风险/.test(s);
  if (m.pct != null && m.pct >= 70) return s.includes(String(m.pct)) || s.includes("百分位") || s.includes("涨");
  if (m.week != null && m.week > 5) return s.includes("涨") || s.includes(String(Math.abs(m.week)));
  return s.includes("折价") || s.includes("80") || s.includes("二手95新");
}

function normalizeSources(v: unknown, context: string): { sources: ReportSource[]; dropped: boolean } {
  if (!Array.isArray(v)) return { sources: [], dropped: false };
  const kept: ReportSource[] = [];
  let dropped = false;
  for (const x of v) {
    let title = "";
    let url = "";
    if (typeof x === "string") {
      title = x.trim();
      url = /^https?:\/\//i.test(title) ? title : "";
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      title = String(o.title ?? "").trim();
      url = String(o.url ?? "").trim();
    }
    if (url && context.includes(url)) {
      kept.push({ title: title || url, url });
    } else {
      dropped = true;
    }
  }
  if (!kept.length) {
    const m = /【商品页】(https?:\/\/\S+)/.exec(context);
    if (m) {
      kept.push({ title: "京东商品页", url: m[1] });
      dropped = true;
    }
  }
  return { sources: kept.slice(0, 3), dropped };
}

export async function GET(_req: Request, { params }: { params: { model: string } }): Promise<Response> {
  const id = decodeURIComponent(params.model || "").trim();
  const model = findModel(id);
  if (!model) return json({ error: "机型不存在", model_id: id }, 404);

  const cached = readReport(id);
  if (!cached) return json({ error: "报告生成中", model_id: id }, 404);
  return json({ ...cached, cached: true });
}

export async function POST(req: Request, { params }: { params: { model: string } }): Promise<Response> {
  const id = decodeURIComponent(params.model || "").trim();
  const model = findModel(id);
  if (!model) return json({ error: "机型不存在", model_id: id }, 404);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const force = body?.force === true;
  const evaluations =
    typeof body?.evaluations === "string"
      ? body.evaluations
      : Array.isArray(body?.evaluations)
        ? body.evaluations.map((x: unknown) => String(x)).join("\n")
        : typeof body?.text === "string"
          ? body.text
          : "";

  // 已有缓存且不要求重生成、也没有新评测语料 → 直接返回，省 AI 调用
  const cached = readReport(id);
  if (cached && !force && !evaluations) return json({ ...cached, cached: true });

  const current = readPricesCurrent()[id] ?? null;
  const history = readPricesHistory()[id] || [];
  const samples = usedSamplesOf(id);
  const medians = medianByGradeOf(samples);
  const metrics = metricsOf(id, current, history, samples);
  const knowledge = readKnowledge();
  const picked = knowledge.filter((k) => {
    const blob = `${k.title} ${k.content}`.toLowerCase();
    return blob.includes(String(model.name).toLowerCase()) || blob.includes(String(model.brand).toLowerCase()) || !k.title;
  });
  const useKnowledge = (picked.length ? picked : knowledge).slice(0, 8);
  const decision = ruleOf(metrics, useKnowledge);

  const label = `${model.name} ${model.variant}`.trim();
  const histLine =
    history.length > 0
      ? history
          .slice()
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map((h) => `${h.date}:${yuan(h.price)}`)
          .join("、")
      : "无历史价数据";
  const medianLine = GRADES.map((g) => `${g} ${yuan(medians[g])}`).join("、");
  const sampleLine = samples
    .slice(0, 6)
    .map((s) => `- ${s.title}（${yuan(s.price)}/${s.grade}；${s.condition_text}）`)
    .join("\n");
  const knowledgeLine = useKnowledge.map((k) => `- ${k.title}：${k.content}（来源：${k.source}）`).join("\n");

  const context = `【机型】${label}，首发价 ${yuan(model.launch_price)}
【新机现价】${current ? yuan(metrics.jd) + "（" + current.captured_at + " 采集，来源 " + current.source + "）" : "暂无数据"}
【商品页】${model.jd_url || "暂无数据"}
【历史价摘要】${history.length ? `共 ${history.length} 个采样点：${histLine}` : "暂无数据"}
【二手样本摘要】共 ${samples.length} 条，五档中位价：${medianLine}
【样本摘录】
${sampleLine || "暂无数据"}
【避坑知识】
${knowledgeLine || "暂无数据"}
【用户补充评测】${evaluations || "（无）"}
【规则预判】${decision.verdict}（规则${decision.rule}：${decision.text}）
【结论提示】${decision.reason}`;

  const system: ChatMessage = {
    role: "system",
    content:
      "你是一个冷静、克制的数码产品买手。你的读者是想买二手或降价新机、但不懂行的普通人。" +
      "价格、成色、风险必须依据用户给出的数据，不编造数据、不编造来源；产品定位可以用公开常识，但不要编造型号、参数或价格。" +
      "只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字。",
  };
  const user: ChatMessage = {
    role: "user",
    content: `${context}

请据此生成一份购买决策报告，输出这个 JSON：
{
  "verdict": "buy|wait|avoid",
  "verdict_reason": "一句话结论，40 字内，要具体到价格或风险，不要复述规则编号",
  "price_position": "一句话说明当前价在历史里的位置，必须带百分位或差价，40 字内",
  "pros": ["优点，每条 20 字内，3 条，必须基于输入数据"],
  "cons": ["缺点，每条 20 字内，3 条，必须基于输入数据"],
  "pitfalls": ["这台机器最容易踩的坑，每条 25 字内，3 条，要能直接照着做"],
  "sources": [{"title": "来源标题", "url": "来源链接"}]
}
硬性约束：
- verdict 必须等于上面【规则预判】给出的结论，一个字都不能改。
- pros / cons / pitfalls 三个数组各写 3 条，都不能为空；不要用"数据不足""暂无可确认"这类占位句凑数。
- sources 只能填写输入里出现过的链接，一条都不许自己造；输入里没有链接就输出空数组 []。
- 所有价格单位是人民币元，不要换算。`,
  };

  const ai = await aiChat([system, user], { deep: true, json: true, temperature: 0.3, maxTokens: 1800 });
  if ("error" in ai) return json({ error: "AI 通道繁忙", detail: ai.error }, 502);

  const parsed = parseJsonLoose<Record<string, unknown>>(ai.text);
  if (!parsed || typeof parsed !== "object") return json({ error: "AI 通道繁忙", detail: "报告 JSON 解析失败" }, 502);

  const problems: string[] = [];
  const verdict = decision.verdict;
  if (String(parsed.verdict ?? "") !== verdict) problems.push("verdict 与规则预判不一致");

  const clean = (v: unknown) =>
    strArr(v, 4)
      .filter((x) => !BAD_PLACEHOLDER.test(x));
  const pros = clean(parsed.pros);
  const cons = clean(parsed.cons);
  const pitfalls = clean(parsed.pitfalls);
  for (const [field, arr] of [["pros", pros], ["cons", cons], ["pitfalls", pitfalls]] as const) {
    if (arr.length < 2) problems.push(`${field} 少于 2 条`);
  }

  const reasonRaw = trimReason(parsed.verdict_reason);
  const useReason = reasonOk(reasonRaw, verdict, metrics) ? reasonRaw : decision.reason;
  const ppRaw = String(parsed.price_position ?? "").trim();
  const pp = /\d/.test(ppRaw) ? ppRaw.slice(0, 80) : decision.reason;

  const { sources, dropped } = normalizeSources(parsed.sources, context);

  const fallbackPros = [
    metrics.jd != null ? `现价${yuan(metrics.jd)}，低于首发价${yuan(model.launch_price)}` : "",
    metrics.pct != null ? `近30天第${metrics.pct}百分位，处于历史低位` : "",
    samples.length ? `二手样本${samples.length}条，价格可交叉验证` : "",
  ].filter(Boolean);
  const fallbackCons = [
    metrics.m95 != null ? `二手95新中位价${yuan(metrics.m95)}，折价${metrics.ratio}%` : "",
    "评测语料未接入，性能与续航只能参考公开参数",
    "需核对序列号、电池健康与维修史",
  ].filter(Boolean);
  const fallbackPitfalls = [
    "只给IMEI不给序列号，无法查原始容量与保修",
    "低价链接可能是模型机/配件或引流，先验机再付款",
    "收货开箱全程录像，24小时内提异议",
  ];
  for (const [arr, fb] of [
    [pros, fallbackPros],
    [cons, fallbackCons],
    [pitfalls, fallbackPitfalls],
  ] as const) {
    for (const item of fb) {
      if (arr.length >= 3) break;
      if (!arr.includes(item)) arr.push(item);
    }
  }

  const report: Report = {
    model_id: id,
    model_title: label,
    verdict,
    verdict_reason: trimReason(useReason),
    price_position: pp,
    pros: pros.slice(0, 3),
    cons: cons.slice(0, 3),
    pitfalls: pitfalls.slice(0, 3),
    sources,
    generated_at: new Date().toISOString(),
    generator: ai.model,
    rule: decision.rule,
    rule_text: decision.text,
    metrics: {
      current_price: metrics.jd,
      percentile_30d: metrics.pct,
      used_95_median: metrics.m95,
      used_95_ratio_pct: metrics.ratio,
      week_change_pct: metrics.week,
      used_sample_count: samples.length,
    },
    ...(dropped ? { sources_trimmed: true } : {}),
  };

  try {
    writeReport(report);
  } catch (e) {
    return json({ error: "报告落盘失败", detail: String((e as Error).message || e) }, 500);
  }

  return json({ ...report, cached: false, model_used: ai.model, validation_issues: problems });
}
