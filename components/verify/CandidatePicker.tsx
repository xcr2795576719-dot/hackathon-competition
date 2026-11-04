"use client";

import ModelThumb from "./ModelThumb";
import type { VerifyCandidate } from "./types";

/**
 * 识机 Top3 候选卡片（v2.2）。
 * 独立组件：验机卡只负责把它渲染出来 + 接收点选结果，改版时不用动这里的逻辑。
 * 目的很直接——AI 第一猜错了，用户能在这里一点就改对。
 */
export default function CandidatePicker({
  candidates,
  pickedName,
  onPick,
}: {
  candidates: VerifyCandidate[];
  /** null = 采用 AI 主猜测 */
  pickedName: string | null;
  onPick: (name: string | null) => void;
}) {
  if (candidates.length < 2) return null;
  const first = candidates[0];

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-slate-500">
        <span>不是这个型号？从候选里选</span>
        <span className="text-[10px] tracking-wide text-slate-400">
          {candidates.length} CANDIDATES · TOP3
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {candidates.map((c) => {
          const active = pickedName ? c.name === pickedName : c.name === first.name;
          return (
            <button
              key={`${c.name}-${c.model_id ?? "x"}`}
              type="button"
              aria-pressed={active}
              // 点回主猜测 = 放弃覆盖，恢复默认口径
              onClick={() => onPick(c.name === first.name ? null : c.name)}
              className={`overflow-hidden rounded-lg border p-1 text-left transition ${
                active
                  ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-200"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <ModelThumb
                src={c.reference_image}
                brand={c.brand}
                name={c.model_name || c.name}
              />
              <div className="px-0.5 pb-0.5 pt-1.5">
                <p className="line-clamp-2 text-[11px] leading-tight text-slate-800">
                  {c.model_name || c.name}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-blue-600">
                    {c.confidence}%
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {active ? "已选择" : c.model_id ? "点选改判" : "目录外"}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, c.confidence))}%`,
                    }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
