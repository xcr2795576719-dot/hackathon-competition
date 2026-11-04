// lib/last-verify.ts —— 最近一次验机结果的浏览器侧存取（客户端专用）
// 写入方：components/verify/InspectCard.tsx（识机成功 / 用户改选候选后）
// 读取方：components/assistant/AssistantWidget.tsx（作为 AI 助手的上下文）
// 24 小时过期：ts 超时的旧结果不再带进对话，避免拿昨天的成色讲今天的行情。

export type LastVerifyDefect = { area: string; type: string; severity: string };

export type LastVerifyEstimate = { low: number; mid: number; high: number };

export type LastVerify = {
  model_id: string | null;
  model_name: string;
  condition_score: number;
  grade: string;
  defects: LastVerifyDefect[];
  estimate: LastVerifyEstimate | null;
  current_price: number | null;
  ts: number;
};

export const LAST_VERIFY_KEY = "jiijian_last_verify";

/** 24 小时 */
export const LAST_VERIFY_TTL = 24 * 60 * 60 * 1000;

export function writeLastVerify(payload: Omit<LastVerify, "ts">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAST_VERIFY_KEY,
      JSON.stringify({ ...payload, ts: Date.now() })
    );
  } catch {
    // 隐私模式 / 配额满：静默失败，助手降级为「无上下文」
  }
}

export function readLastVerify(): LastVerify | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_VERIFY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LastVerify;
    if (!data || typeof data !== "object") return null;
    if (typeof data.ts !== "number" || Date.now() - data.ts > LAST_VERIFY_TTL) return null;
    if (!data.model_name && !data.model_id) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearLastVerify(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_VERIFY_KEY);
  } catch {
    // ignore
  }
}
