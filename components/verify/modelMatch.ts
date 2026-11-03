// 把识机返回的 model_guess 对齐到 models.json 的 model_id（用于跳报告页）
import modelsJson from "@/data/models.json";

export const FALLBACK_MODEL_ID = "iphone-13-128g";

type ModelRow = { id: string; brand: string; name: string; variant: string; tier: number };

const MODELS = modelsJson as ModelRow[];

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[\s\-_/]+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/苹果/g, "iphone")
    .replace(/华为/g, "huawei")
    .replace(/小米/g, "xiaomi")
    .replace(/红米/g, "redmi");
}

export type ModelMatch = { id: string; matched: boolean; label: string };

// 型号后缀是硬区分：iPhone 13 / 13 Pro / 13 Pro Max 是三种机器，
// 不能因为「都叫 iPhone 13」就匹配到同一个 128G 目录项。
const QUALIFIERS = ["promax", "pro", "max", "plus", "ultra", "mini", "se", "fold", "flip"];

function qualifiersOf(s: string): string[] {
  return QUALIFIERS.filter((q) => s.includes(q));
}

export function guessModelSlug(guess?: string): ModelMatch {
  const g = norm(guess ?? "");
  if (!g) {
    return { id: FALLBACK_MODEL_ID, matched: false, label: "未识别到机型，按 iPhone 13 128G 兜底" };
  }

  const gq = qualifiersOf(g);
  let best: { row: ModelRow; score: number } | null = null;

  for (const row of MODELS) {
    const rowName = norm(row.name);
    // 猜出的 Pro/Max/Plus 等后缀，目标机型必须也有；否则宁可不匹配，也不跳错报告
    if (gq.some((q) => !rowName.includes(q))) continue;

    const keys = [rowName, norm(row.name + row.variant), norm(row.variant)];
    for (const key of keys) {
      if (!key || key.length < 3) continue;
      let score = 0;
      if (g === key) score = 100 + key.length;
      else if (g.includes(key)) score = 60 + key.length;
      else if (key.includes(g) && g.length >= 4) score = 40 + g.length;
      if (score > 0) score += row.tier === 1 ? 5 : 0;
      if (score > (best?.score ?? 0)) best = { row, score };
    }
  }

  if (!best) {
    return { id: FALLBACK_MODEL_ID, matched: false, label: "未识别到机型，按 iPhone 13 128G 兜底" };
  }

  const row = best.row;
  return {
    id: row.id,
    matched: true,
    label: `匹配机型：${row.name} ${row.variant}`,
  };
}
