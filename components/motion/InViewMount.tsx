"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 进视口才挂载子节点。
 * 图表用它：ECharts 挂载即播绘制动画，若在首屏外初始化，
 * 用户滚到时动画早就结束了——留在视口内再挂载，曲线才是"滚出来"的。
 *
 * minHeight 用来占位，避免延迟挂载造成布局跳动。
 */
export default function InViewMount({
  children,
  minHeight = 320,
  className = "",
}: {
  children: ReactNode;
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShow(true);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ minHeight }}>
      {show ? children : null}
    </div>
  );
}
