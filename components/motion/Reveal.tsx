"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 入场揭示：元素进入视口时上浮 + 淡入，只播一次。
 *
 * 关键约束：默认状态必须是"可见"的。隐藏只发生在 <html class="js"> 下
 * （layout 里的内联脚本在首屏绘制前加上），这样即使脚本失败或用户禁用 JS，
 * 内容也不会永久隐形。
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
  id,
}: {
  children: ReactNode;
  /** 毫秒，用于同级元素之间做序列 */
  delay?: number;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 尊重系统"减少动态效果"
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      el.classList.add("is-in");
      return;
    }

    // 首屏已在视口内的元素直接播，不做延迟，避免开屏空着
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      data-reveal=""
      className={className}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
