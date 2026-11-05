// POST /api/assistant
// 入参：{ messages: [{role:"user"|"assistant", content}], context?: { model_id, model_name } }
// 流程：把用户刚验机的型号/成色/瑕疵/估价/新机价拼进 system prompt → aiChat(qwen-plus) → { reply }
// 不做流式：演示场景下一次性返回更稳，前端渲染纯文本（保留换行）。
import { aiChat, type ChatMessage } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CtxDefect = { area?: unknown; type?: unknown; severity?: unknown };

type AssistContext = {
  model_id?: string | null;
  model_name?: string | null;
  condition_score?: number | null;
  grade?: string | null;
  defects?: CtxDefect[] | null;
  estimate?: { low?: number | null; mid?: number | null; high?: number | null } | null;
  current_price?: number | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function yuan(n: number): string {
  return `¥${Math.round(n).toLocaleString("zh-CN")}`;
}

/** 验机上下文 → 提示词里的「事实块」。数字全部在这里算好，别让模型自己算。 */
function contextBlock(ctx: AssistContext | null): string {
  const name = typeof ctx?.model_name === "string" ? ctx.model_name.trim() : "";
  const score = num(ctx?.condition_score);
  const grade = typeof ctx?.grade === "string" ? ctx.grade.trim() : "";
  const low = num(ctx?.estimate?.low);
  const mid = num(ctx?.estimate?.mid);
  const high = num(ctx?.estimate?.high);
  const current = num(ctx?.current_price);
  const defects: CtxDefect[] = Array.isArray(ctx?.defects) ? (ctx?.defects as CtxDefect[]) : [];

  const hasAny = Boolean(name || score || grade || low || current);
  if (!hasAny) {
    return `【验机数据】暂无。用户还没在这台设备上拍照验机。
处理方式：先用一句话引导用户去 /verify 拍照验机（能拿到型号、成色分、瑕疵清单和二手估价），再回答他问的问题。
可以讲通用判断原则，但绝不能报具体价格数字、也不能编造行情。`;
  }

  const lines: string[] = ["【这台机器的验机数据（唯一可用的事实来源）】"];
  lines.push(`- 机型：${name || "未识别"}${ctx?.model_id ? `（model_id: ${ctx.model_id}）` : ""}`);
  if (score) lines.push(`- 外观成色分：${Math.round(score)}/100${grade ? `，五档口径 ${grade}` : ""}`);
  if (defects.length) {
    const list = defects
      .map((d) => {
        const area = String(d?.area ?? "").trim();
        const type = String(d?.type ?? "").trim();
        const sev = String(d?.severity ?? "").trim();
        return [area, type, sev].filter(Boolean).join("·");
      })
      .filter(Boolean)
      .slice(0, 5);
    lines.push(`- 可见瑕疵 ${defects.length} 处：${list.join("；")}`);
  } else {
    lines.push(`- 可见瑕疵：照片里没看出明显瑕疵（不代表内部无问题）`);
  }
  if (low && high) {
    lines.push(
      `- 二手估价区间：${yuan(low)} ~ ${yuan(high)}${mid ? `（中位 ${yuan(mid)}）` : ""}，按成色档位与同类在售样本推算`
    );
  } else {
    lines.push(`- 二手估价区间：该机型暂无二手样本，估不出来`);
  }
  if (current) lines.push(`- 新机现价：${yuan(current)}`);
  if (low && high && current && mid) {
    const ratio = Math.round((mid / current) * 100);
    lines.push(`- 二手中位价为新机价的 ${ratio}%（卖旧换新的差价就是 ${yuan(current - mid)} 起）`);
  }
  return lines.join("\n");
}

const SYSTEM_RULES = `你是「机鉴 AI 助手」，站在用户这边的二手数码顾问。用户刚拍完照验完机，你手里有这台机器的型号、成色、瑕疵、二手估价和新机价。用户会问各种问题，不都是"该不该卖"。

【先判断问题类型，再决定怎么答】
A. 处置类（该卖吗 / 该留吗 / 要不要修 / 要不要换新）
   → 第一行用 **两个星号** 给一句结论；空一行；2~3 条理由，每条以「· 」开头；需要时最后一行「注意：…」。全文 ≤180 字。
B. 解释类（估价区间怎么读 / 成色档位什么意思 / 这处划痕要紧吗 / 这个型号什么水平 / 怎么挂闲鱼 / 怎么补拍）
   → 直接用 2~4 句话说清，不要套上面的结论模板，不要用「· 」列表，不要硬塞"卖旧换新"。
C. 闲聊或与这台机器无关（打招呼、问你是谁、问别的机型）
   → 自然回一句（≤60 字），可以顺带问要不要看这台机器，但不要每次都说"卖掉"。
D. 数据里没有的（电池健康度、拆修史、进水史、屏幕是否原装）
   → 直说「照片看不出来」，再用一句话告诉用户怎么自查（例如 设置→电池→电池健康），不要编数字。

【硬规则】
- 只引用上面给出的数据，数字照抄；可以算占比，不许四舍五入到失真
- 不要每轮都用同一句结论、同一个理由顺序；用户已经听过就换个说法或直接答新问题
- 不推销、不夸大、不承诺能卖多少钱：给的是判断依据，不是收购报价
- 用户没说清机型时先问清楚，不要自己猜
- 不确定就说不确定，不要为了凑格式编内容`;

export async function POST(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const messages: ChatMessage[] = rawMessages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m: ChatMessage) => typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-10);

  if (!messages.length) {
    return json({ error: "缺少 messages（至少一条 user 内容）" }, 400);
  }

  const ctx: AssistContext | null =
    body?.context && typeof body.context === "object" ? (body.context as AssistContext) : null;

  const system: ChatMessage = {
    role: "system",
    content: `${SYSTEM_RULES}\n\n${contextBlock(ctx)}`,
  };

  const result = await aiChat([system, ...messages], {
    timeoutMs: 45_000,
    maxTokens: 700,
    // 处置类问题要稳（数字不能飘），但又不能每轮同一句话，0.7 是这里的手感平衡点
    temperature: 0.7,
  });

  if ("error" in result) {
    console.warn("[assistant] AI 失败:", result.error);
    return json({ error: "AI 通道繁忙，稍后再试" }, 502);
  }

  return json({ reply: result.text.trim(), model_used: result.model });
}
