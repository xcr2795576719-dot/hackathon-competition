import type { NormalizedPricePosition } from "./types";

export default function PricePositionBar({
  position,
}: {
  position: NormalizedPricePosition;
}) {
  const { percentile, current, low, high, median, label } = position;

  // 没有百分位（泳道3 可能只给文字描述）→ 降级展示
  if (percentile == null) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">价格位置</h2>
        <p className="text-sm text-slate-500">
          {label || "暂无价格位置数据"}
        </p>
      </section>
    );
  }

  const p = Math.min(100, Math.max(0, percentile));
  const hint = p <= 30 ? "处于历史低位" : p <= 70 ? "处于历史中位" : "接近历史高位";
  const markerColor =
    p <= 30 ? "bg-green-500" : p <= 70 ? "bg-amber-500" : "bg-red-500";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-700">价格位置</h2>
        <span className="text-xs text-slate-500">
          比历史 {100 - p}% 的时间更便宜 · {label || hint}
        </span>
      </div>

      <div className="relative h-3 w-full overflow-visible rounded-full bg-slate-100">
        <div className="scale-fill absolute inset-0 rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-red-400" />
        <div
          className={`marker-slide absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${markerColor}`}
          style={{ left: `${p}%`, ["--p" as string]: `${p}%` } as React.CSSProperties}
          aria-label={`历史百分位 ${p}%`}
        />
      </div>

      {(() => {
        // 有历史高低价就画三格；只有一句话里抠出的当前价与中位时画两格
        const cells =
          low != null || high != null
            ? [
                { k: "历史最低", v: low, strong: false },
                { k: "当前价", v: current, strong: true },
                { k: "历史最高", v: high, strong: false },
              ]
            : median != null || current != null
              ? [
                  { k: "30 天中位", v: median, strong: false },
                  { k: "当前价", v: current, strong: true },
                ]
              : [];
        if (!cells.length) return null;
        return (
          <div
            className={`mt-5 grid gap-3 text-center text-xs text-slate-500 ${
              cells.length === 3 ? "grid-cols-3" : "mx-auto max-w-[260px] grid-cols-2"
            }`}
          >
            {cells.map((c) => (
              <div key={c.k}>
                <div
                  className={`tabular-nums ${
                    c.strong ? "font-semibold text-slate-900" : "text-slate-800"
                  }`}
                >
                  ¥{c.v ?? "—"}
                </div>
                <div>{c.k}</div>
              </div>
            ))}
          </div>
        );
      })()}
    </section>
  );
}
