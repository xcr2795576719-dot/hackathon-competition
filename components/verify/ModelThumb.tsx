/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

/** 品牌色：无参考图时用它兜底，避免一片灰分不出谁是谁 */
const BRAND_TONE: Record<string, string> = {
  Apple: "#334155",
  华为: "#dc2626",
  小米: "#ea580c",
  Redmi: "#b91c1c",
  荣耀: "#2563eb",
  OPPO: "#16a34a",
  vivo: "#0ea5e9",
  iQOO: "#ca8a04",
  三星: "#4f46e5",
  一加: "#ea580c",
};

/** 目录外的机型（如 iPhone 15 Pro Max 不在 20 款目录里）没有 brand 字段，按名字反推 */
const BRAND_HINTS: Array<[RegExp, string]> = [
  [/iphone|ipad|macbook|airpods/i, "Apple"],
  [/华为|mate|nova|p60/i, "华为"],
  [/redmi/i, "Redmi"],
  [/小米|xiaomi|\bk\d{2}\b/i, "小米"],
  [/荣耀|honor/i, "荣耀"],
  [/oppo|reno/i, "OPPO"],
  [/vivo|iqoo/i, "vivo"],
  [/三星|galaxy|samsung/i, "三星"],
  [/一加|oneplus/i, "一加"],
];

function inferBrand(name: string): string {
  for (const [re, brand] of BRAND_HINTS) if (re.test(name)) return brand;
  return "";
}

/**
 * 候选机型的参考图。
 * 约定路径 public/models/<model_id>.jpg；图还没入库时 img onError 会降级成
 * 「品牌色块 + 品牌名 + 型号名」的占位，绝不出现裂图。
 */
export default function ModelThumb({
  src,
  brand,
  name,
}: {
  src?: string | null;
  brand?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = brand || inferBrand(name);
  const tone = BRAND_TONE[label] ?? "#64748b";
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className="relative w-full overflow-hidden rounded-md bg-slate-50"
      style={{ aspectRatio: "4 / 3" }}
    >
      {showImage ? (
        <img
          src={src as string}
          alt={`${name} 参考图`}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1"
          style={{
            background: `linear-gradient(135deg, ${tone}1f 0%, #f8fafc 78%)`,
          }}
        >
          <span
            className="text-[10px] font-semibold tracking-wider"
            style={{ color: tone }}
          >
            {(label || "MODEL").toUpperCase()}
          </span>
          <span className="line-clamp-2 text-center text-[10px] leading-tight text-slate-400">
            {name}
          </span>
        </div>
      )}
    </div>
  );
}
