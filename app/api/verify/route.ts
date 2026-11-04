// POST /api/verify
// 入参：{ image: "data:image/jpeg;base64,..." } 或纯 base64
// 流程：aiVision(glm-4v-flash) → parseJsonLoose；解析失败用 qwen3-vl-plus 备选再试一次；
//       仍失败 502 { error: "AI 通道繁忙" }；缺 image 400。
// 返回结构（E 版 schema）：{ category, model_guess, confidence(0-100), candidates[], visible_defects[], condition_score, notes }
// 后处理：model_guess → models.json 匹配出 model_id / model_name 一起返回（识别失败为 null）。
//         candidates 里的每个 name 同样匹配，命中时补 model_id / model_name / reference_image（v2.2）。
//         前端 B 的 InspectCard 直接读 model_id 跳估价，不再走 guessModelId 兜底。
// 提示词：优先读 docs/prompts/verify.md，文件缺失时回落内置 FALLBACK_PROMPT 并 console.warn。
//         FALLBACK_PROMPT 是副本，真源永远是 docs/prompts/verify.md（E 维护，v2.2）。
import fs from "node:fs";
import path from "node:path";
import { aiVision, parseJsonLoose } from "@/lib/ai";
import type { Model } from "@/lib/data";
import { readJson, PATHS } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 内置回落提示词（docs/prompts/verify.md 缺失时使用）
const FALLBACK_PROMPT = `你是数码产品验机专家。分析这张产品照片，只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。

{
  "category": "手机|耳机|相机|笔记本|平板|手表|其他",
  "model_guess": "最可能的型号名，带上容量/版本，无法判断写未知",
  "confidence": 0到100的整数,
  "candidates": [
    {"name": "最可能的型号名，带容量/版本", "confidence": 0到100的整数},
    {"name": "第二可能的型号名", "confidence": 比第一个低的整数},
    {"name": "第三可能的型号名", "confidence": 更低的整数}
  ],
  "visible_defects": [
    {
      "area": "上左|上中|上右|中左|正中|中右|下左|下中|下右|屏幕|边框|背面|镜头|接口|未知",
      "type": "划痕|磕碰|裂纹|污渍|屏幕老化|维修痕迹|进水痕迹|无",
      "severity": "轻微|中等|严重",
      "detail": "一句话描述你看到的位置和程度"
    }
  ],
  "condition_score": 0到100的整数,
  "notes": "30字以内的补充判断"
}

判断规则：
1. 只写你在照片里真的看见的瑕疵。看不清、被遮挡、角度拍不到的，不要猜，也不要写"无"占位。
2. visible_defects 没有发现任何瑕疵时，输出空数组 []。
3. condition_score 按外观成色打分：95-100 无可见使用痕迹；85-94 轻微使用痕；70-84 明显划痕或小磕碰；50-69 多处划痕磕碰；0-49 碎裂、变形或明显维修痕迹。
4. area 只能是上面列出的值。整体问题用 屏幕/边框/背面/镜头/接口，局部问题用九宫格方位。
5. 照片不是数码产品时，只输出 {"error":"not_product"}。
6. 照片模糊、反光、只拍到局部时，confidence 给低分，并在 notes 里说明原因。
7. candidates 必须正好 3 条（不是 1 条、不是 2 条），按置信度从高到低排列；第一个必须和 model_guess 完全一致、confidence 与顶层 confidence 相同；三个 confidence 相加不超过 100。
8. candidates 的 name 用「品牌 + 型号 + 容量/版本」写法，例如 "iPhone 13 128G"、"小米 14 12+256G"；外观相近的型号（如 iPhone 13 / iPhone 14、Mate 60 / Mate 60 Pro）要一并列出，用户会自己点选确认。
9. 完全认不出型号时，candidates 给 3 个"可能的品类代表机型"，仍按置信度降序，不要编造容量。`;

function loadPrompt(): string {
  const promptPath = path.join(process.cwd(), "docs", "prompts", "verify.md");
  try {
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, "utf-8");
    }
  } catch {
    // fall through
  }
  console.warn("[verify] docs/prompts/verify.md 缺失，使用内置回落提示词");
  return FALLBACK_PROMPT;
}

const RETRY_PROMPT = loadPrompt() + `\n注意：上一次回复不是合法 JSON。这次第一字符必须是 {，最后一字符必须是 }，不要解释，不要 Markdown 代码块。`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s\-_/\\()（）【】\[\]·,，。.:：+*"']/g, "");
}

/** 把 AI 猜的型号名对到机型目录，用于后续跳报告/估价 */
function matchModel(guess: unknown, models: Model[]): Model | null {
  const g = norm(guess);
  if (!g) return null;
  const qualifiers = ["promax", "pro", "max", "plus", "ultra", "mini", "se"].filter((q) => g.includes(q));
  let best: { m: Model; score: number } | null = null;
  for (const m of models) {
    const name = norm(m.name);
    const variant = norm(m.variant);
    // iPhone 13 Pro Max 不能匹配到 iPhone 13 128G：后缀是硬区分
    if (qualifiers.some((q) => !name.includes(q))) continue;
    let score = 0;
    if (name && g.includes(name)) score += 10;
    else if (name && name.includes(g) && g.length >= 3) score += 6;
    if (variant && g.includes(variant)) score += 3;
    if (g.includes(norm(m.brand))) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { m, score };
  }
  return best ? best.m : null;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

const SEVERITIES = ["轻微", "中等", "严重"];

/** 候选里的机型参考图：约定 public/models/<model_id>.jpg，缺图时前端降级成品牌色占位 */
function referenceImageOf(modelId: string): string {
  return `/models/${modelId}.jpg`;
}

type Candidate = {
  name: string;
  confidence: number;
  model_id: string | null;
  model_name: string | null;
  brand: string | null;
  reference_image: string | null;
};

/**
 * v2.2：候选机型列表。
 * - 每条 name 复用 matchModel 对到机型目录，命中才给 model_id / reference_image；
 * - 顶层 model_guess 若不在候选里，用顶层 confidence 补到第一位；
 * - 去重后按置信度降序，最多 3 条。
 */
function normalizeCandidates(
  raw: Record<string, unknown>,
  models: Model[],
  guess: string,
  guessConfidence: number,
  matched: Model | null
): Candidate[] {
  const list = Array.isArray(raw.candidates) ? (raw.candidates as unknown[]) : [];
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (nameRaw: unknown, confRaw: unknown) => {
    const name = String(nameRaw ?? "").trim().slice(0, 40);
    if (!name || name === "未知") return;
    const key = norm(name);
    if (seen.has(key)) return;
    seen.add(key);
    const m = matchModel(name, models);
    out.push({
      name,
      confidence: clampInt(confRaw, 0, 100, 0),
      model_id: m ? m.id : null,
      model_name: m ? `${m.name} ${m.variant}`.trim() : null,
      brand: m ? m.brand : null,
      reference_image: m ? referenceImageOf(m.id) : null,
    });
  };

  for (const c of list.slice(0, 6)) {
    const o = (c || {}) as Record<string, unknown>;
    push(o.name, o.confidence);
  }

  // 主猜测必须出现在候选首位：认出来的机型名以目录口径为准，未认出就用原文
  const guessName = matched ? `${matched.name} ${matched.variant}`.trim() : guess;
  const guessKey = norm(guessName);
  if (guessName && guessKey && guessName !== "未知") {
    const main: Candidate = {
      name: guessName,
      confidence: guessConfidence,
      model_id: matched ? matched.id : null,
      model_name: matched ? `${matched.name} ${matched.variant}`.trim() : null,
      brand: matched ? matched.brand : null,
      reference_image: matched ? referenceImageOf(matched.id) : null,
    };
    // 同一台机可能被模型写成「iPhone 13」和「iPhone 13 128G」，按 model_id / 归一化名称判重
    const dupIndex = out.findIndex(
      (c) => (matched && c.model_id === matched.id) || norm(c.name) === guessKey
    );
    if (dupIndex >= 0) {
      out[dupIndex] = { ...out[dupIndex], ...main };
      const [dup] = out.splice(dupIndex, 1);
      out.unshift(dup);
    } else {
      out.unshift(main);
    }
  }

  const sorted = out.sort((a, b) => b.confidence - a.confidence);
  // 主猜测永远排第一：模型给的候选置信度之和偶尔会越界，展示顺序不能跟着乱
  const mainIndex = sorted.findIndex(
    (c) => (matched && c.model_id === matched.id) || norm(c.name) === guessKey
  );
  if (mainIndex > 0) {
    const [main] = sorted.splice(mainIndex, 1);
    sorted.unshift(main);
  }
  return sorted.slice(0, 3);
}

/** 归一成固定结构，字段缺失也补齐，前端不用防御 */
function normalizeVision(raw: Record<string, unknown>, models: Model[]) {
  const defectsRaw = Array.isArray(raw.visible_defects) ? (raw.visible_defects as Record<string, unknown>[]) : [];
  const visible_defects = defectsRaw.slice(0, 12).map((d) => {
    const o = (d || {}) as Record<string, unknown>;
    const sev = String(o.severity ?? "").trim();
    return {
      area: String(o.area ?? "未知").slice(0, 20),
      type: String(o.type ?? "瑕疵").slice(0, 20),
      severity: (SEVERITIES.includes(sev) ? sev : sev.includes("严重") || sev.includes("重") ? "严重" : sev.includes("中") ? "中等" : "轻微") as string,
      detail: String(o.detail ?? "").slice(0, 60),
    };
  });

  const matched = matchModel(raw.model_guess, models);
  const modelGuess = String(raw.model_guess ?? "未知").slice(0, 40);
  const confidence = clampInt(raw.confidence, 0, 100, 60);
  return {
    category: String(raw.category ?? "手机").slice(0, 12),
    model_guess: modelGuess,
    confidence,
    candidates: normalizeCandidates(raw, models, modelGuess, confidence, matched),
    visible_defects,
    condition_score: clampInt(raw.condition_score, 0, 100, 75),
    notes: String(raw.notes ?? "").slice(0, 60),
    model_id: matched ? matched.id : null,
    model_name: matched ? `${matched.name} ${matched.variant}`.trim() : null,
  };
}

/** 备选通道：直连 DashScope OpenAI 兼容口，只跑 qwen3-vl-plus，不走 lib/ai 的模型链 */
async function backupVision(image: string, prompt: string): Promise<string | null> {
  const key = process.env.DASHSCOPE_KEY;
  if (!key) return null;
  const base = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = process.env.QWEN_VISION_MODEL || "qwen3-vl-plus";
  const url = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
  const messages = [
    { role: "system", content: "你是数码产品验机专家，只输出 JSON，不要任何多余文字。" },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url } },
      ],
    },
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1024 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不是合法 JSON，需要 { image: \"data:image/jpeg;base64,...\" }" }, 400);
  }

  const image = typeof body?.image === "string" ? body.image.trim() : "";
  if (!image) return json({ error: "缺少 image（data:image/...;base64,... 或纯 base64）" }, 400);
  if (image.length > 12_000_000) return json({ error: "图片过大，请压到 8MB 以内" }, 413);

  const models = readJson<Model[]>(PATHS.models, []);

  const PROMPT = loadPrompt();

  // 第一次：lib/ai 视觉链（glm-4v-flash → 失败内建切 qwen3-vl-plus）
  const first = await aiVision(image, PROMPT, { timeoutMs: 55_000 });
  if ("text" in first) {
    const parsed = parseJsonLoose<Record<string, unknown>>(first.text);
    if (parsed && typeof parsed === "object") {
      return json({ ...normalizeVision(parsed, models), model_used: first.model });
    }
  }

  // 第二次：换备选模型重试一次
  const backupText = await backupVision(image, RETRY_PROMPT);
  if (backupText) {
    const parsed = parseJsonLoose<Record<string, unknown>>(backupText);
    if (parsed && typeof parsed === "object") {
      return json({
        ...normalizeVision(parsed, models),
        model_used: process.env.QWEN_VISION_MODEL || "qwen3-vl-plus",
      });
    }
  }

  // 走 lib/ai 的备选链再兜一次（覆盖 GLM 成功但 JSON 烂、且没配 DASHSCOPE_KEY 的情况）
  const third = await aiVision(image, RETRY_PROMPT, { timeoutMs: 55_000 });
  if ("text" in third) {
    const parsed = parseJsonLoose<Record<string, unknown>>(third.text);
    if (parsed && typeof parsed === "object") {
      return json({ ...normalizeVision(parsed, models), model_used: third.model });
    }
  }

  return json({ error: "AI 通道繁忙" }, 502);
}
