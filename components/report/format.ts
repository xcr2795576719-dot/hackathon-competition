import type { Verdict } from "./types";

export const VERDICT_STYLE: Record<
  Verdict,
  { label: string; ring: string; bg: string; text: string; dot: string; chip: string }
> = {
  buy: {
    label: "值得买",
    ring: "ring-verdict-buy/30",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-verdict-buy",
    chip: "bg-verdict-buy text-white",
  },
  wait: {
    label: "等降价",
    ring: "ring-verdict-wait/30",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    dot: "bg-verdict-wait",
    chip: "bg-verdict-wait text-white",
  },
  avoid: {
    label: "别买",
    ring: "ring-verdict-avoid/30",
    bg: "bg-red-50",
    text: "text-red-700",
    dot: "bg-verdict-avoid",
    chip: "bg-verdict-avoid text-white",
  },
};

export function verdictOf(v?: string): Verdict {
  const s = String(v ?? "").trim();
  if (s === "buy" || s === "wait" || s === "avoid") return s;
  // 兼容旧版 API 输出的中文结论
  if (s.includes("值得") || s.includes("推荐")) return "buy";
  if (s.includes("别买") || s.includes("避雷") || s.includes("劝退")) return "avoid";
  return "wait";
}

/** 从「近30天第13百分位」里抠出百分位数字，用于进度条。
 *  只认带「百分位」的数字，避免把「降幅28.0%」里的 0% 误读成价格位置。 */
export function parsePercentile(text?: string): number | null {
  if (!text) return null;
  const patterns = [
    /(\d{1,3}(?:\.\d+)?)\s*%\s*百分位/,
    /第\s*(\d{1,3}(?:\.\d+)?)\s*百分位/,
    /(\d{1,3}(?:\.\d+)?)\s*%\s*分位/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

export function priceZone(percentile: number | null): { label: string; className: string } {
  if (percentile === null) return { label: "价格位置未知", className: "text-slate-500" };
  if (percentile <= 25) return { label: "历史低位", className: "text-emerald-700" };
  if (percentile <= 60) return { label: "历史中位", className: "text-yellow-700" };
  if (percentile <= 85) return { label: "偏高", className: "text-orange-700" };
  return { label: "历史高位", className: "text-red-700" };
}

/** 「数据更新于 x 小时前」；没有 generated_at 就标 seed */
export function hoursAgo(iso?: string): { text: string; isSeed: boolean } {
  if (!iso) return { text: "seed（种子数据，无生成时间）", isSeed: true };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { text: "seed（时间字段无法解析）", isSeed: true };
  const diff = Date.now() - t;
  if (diff < 0) return { text: "刚刚（时间戳在未来，请校准）", isSeed: false };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { text: `${Math.max(1, mins)} 分钟前`, isSeed: false };
  const hours = Math.floor(diff / 3600000);
  if (hours < 48) return { text: `${hours} 小时前`, isSeed: false };
  const days = Math.floor(hours / 24);
  return { text: `${days} 天前`, isSeed: false };
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatWan(yuan?: number): string {
  if (!Number.isFinite(yuan ?? NaN)) return "—";
  const n = Number(yuan);
  if (n >= 10000) return `${(n / 10000).toFixed(2)} 万`;
  return `${Math.round(n)} 元`;
}
