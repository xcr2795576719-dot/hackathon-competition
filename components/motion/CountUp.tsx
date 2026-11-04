"use client";

import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 数字滚动：进入视口后从 0 走到目标值。
 * 服务端渲染时直接输出目标值，所以对爬虫/禁用 JS 的访客也是完整数字，
 * 挂载后才重置为 0 起跳（避免"先显示 0 再跳"的空窗）。
 */
export default function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 900,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!Number.isFinite(value)) return;

    let raf = 0;
    let start = 0;
    const run = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      setShown(value * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(run);
      else setShown(value);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          setShown(0);
          raf = requestAnimationFrame(run);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {Math.round(shown).toLocaleString("zh-CN")}
      {suffix}
    </span>
  );
}
