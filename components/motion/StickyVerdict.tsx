"use client";

import { useEffect, useState } from "react";

/**
 * 报告页的"结论回看条"：滚过判定卡之后从顶部滑下，
 * 让你在任何位置都还看得见这台机器的结论，并能一键回到顶部。
 * 不做常驻——它只在判定卡离场后出现，避免和首屏标题打架。
 */
export default function StickyVerdict({
  label,
  tone,
  model,
  price,
}: {
  label: string;
  tone: string;
  model: string;
  price?: number | null;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("report-hero");
    if (!hero) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // 只在上方离场时出现；往下滚回来不闪
          setShow(!e.isIntersecting && e.boundingClientRect.top < 0);
        }
      },
      { threshold: 0 },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={`no-print fixed inset-x-0 top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur transition-transform duration-300 ${
        show ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${tone}`}>
          {label}
        </span>
        <span className="truncate text-sm font-semibold text-slate-900">{model}</span>
        {price != null && (
          <span className="tabular-nums text-sm text-slate-500">
            ¥{Math.round(price).toLocaleString("zh-CN")}
          </span>
        )}
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="ml-auto shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
        >
          回到顶部
        </button>
      </div>
    </div>
  );
}
