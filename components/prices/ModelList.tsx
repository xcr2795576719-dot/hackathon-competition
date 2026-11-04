"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Model } from "./types";
import Reveal from "@/components/motion/Reveal";

const tabs = [
  ["全部", []],
  ["Apple", ["apple"]],
  ["华为", ["华为", "huawei"]],
  ["荣耀", ["荣耀", "honor"]],
  ["小米", ["小米", "xiaomi"]],
  ["Redmi", ["redmi"]],
  ["OPPO / 一加", ["oppo", "一加", "oneplus"]],
  ["vivo / iQOO", ["vivo", "iqoo"]],
  ["三星", ["三星", "samsung"]],
] as const;

export default function ModelList({
  models,
  demo = false,
}: {
  models: Model[];
  demo?: boolean;
}) {
  const [tab, setTab] = useState(0);
  // 筛选条吸顶状态：只有真正贴住顶部时才加底色和投影
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const visible = models.filter(
    (m) =>
      tab === 0 ||
      (tabs[tab][1] as readonly string[]).some((x) =>
        m.brand.toLowerCase().includes(x),
      ),
  );
  const countLabel = demo
    ? "当前展示演示机型"
    : tab === 0
      ? `共 ${models.length} 款机型`
      : `显示 ${visible.length} / 共 ${models.length} 款`;

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          setStuck(!e.isIntersecting && e.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold">浏览机型</h2>
        <span className="text-sm text-slate-500" data-testid="model-count">
          {countLabel}
        </span>
      </div>

      <div ref={sentinel} aria-hidden className="h-px" />

      <div
        className="sticky-tabs sticky top-0 z-30 -mx-5 mt-6 border-b border-transparent px-5 py-3"
        data-stuck={stuck}
      >
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="品牌筛选">
          {tabs.map(([label], i) => (
            <button
              key={label}
              type="button"
              aria-pressed={i === tab}
              onClick={() => setTab(i)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm transition-colors duration-200 ${i === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-slate-500">该品牌机型收集中</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m, i) => (
            <Reveal
              key={`${tab}-${m.id}`}
              delay={Math.min(i, 8) * 45}
              className="h-full"
            >
              <Link
                href={`/prices/${encodeURIComponent(m.id)}`}
                className="group block h-full rounded-xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-[0_16px_32px_-24px_rgba(15,23,42,0.45)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    {m.brand}
                  </span>
                  {m.tier === 1 && (
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      深度验机
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {m.name} {m.variant}
                </h3>
                <p className="mt-3 text-sm text-blue-700">
                  查看行情
                  <span className="ml-1 inline-block transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </p>
              </Link>
            </Reveal>
          ))}
        </ul>
      )}
    </>
  );
}
