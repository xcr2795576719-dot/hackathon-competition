"use client";
import { useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { Point, Sample } from "./types";
const grades = ["99新", "95新", "9成新", "8成新", "大修"];
const colors = ["#16a34a", "#2563eb", "#ca8a04", "#ea580c", "#dc2626"];
export default function PriceCharts({
  history,
  samples,
  focusUsed = false,
  showHistory = true,
}: {
  history: Point[];
  samples: Sample[];
  /** 从验机卡跳过来（?tab=used）：滚动到二手散点图并高亮 */
  focusUsed?: boolean;
  /** T2 机型没有 30 天新机价，只渲染二手散点 */
  showHistory?: boolean;
}) {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(Number(s.price)) &&
      Number(s.price) > 0 &&
      (grades.includes(s.grade) || s.grade === "大修或功能缺陷"),
  );
  const sorted = valid.map((s) => Number(s.price)).sort((a, b) => a - b);
  const mid = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2
    : null;
  const priceOption = {
    tooltip: { trigger: "axis" },
    grid: { left: 65, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: "category",
      data: history.map((p) => p.date),
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: "¥{value}" } },
    series: [
      {
        type: "line",
        smooth: true,
        data: history.map((p) => p.price),
        lineStyle: { color: "#2563eb" },
        itemStyle: { color: "#2563eb" },
        areaStyle: { color: "rgba(37,99,235,.08)" },
      },
    ],
  };
  const scatterOption = {
    tooltip: {
      trigger: "item",
      formatter: (p: { seriesName: string; value: [number, number] }) =>
        `${p.seriesName}<br/>¥${p.value[1]}`,
    },
    legend: { bottom: 0 },
    grid: { left: 65, right: 20, top: 30, bottom: 65 },
    xAxis: { type: "value", name: "样本", min: 0, axisLabel: { show: false } },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: "¥{value}" } },
    series: grades.map((grade, i) => ({
      name: grade,
      type: "scatter",
      itemStyle: { color: colors[i] },
      data: valid
        .map((s, index) => ({ s, index }))
        .filter(
          ({ s }) =>
            s.grade === grade ||
            (grade === "大修" && s.grade === "大修或功能缺陷"),
        )
        .map(({ s, index }) => [index + 1, Number(s.price)]),
      ...(i === 0 && mid !== null
        ? {
            markLine: {
              symbol: "none",
              label: { formatter: `中位价 ¥${mid}` },
              data: [{ yAxis: mid }],
            },
          }
        : {}),
    })),
  };
  const usedRef = useRef<HTMLElement | null>(null);

  // 从验机卡「查看二手行情曲线」跳进来时，把视口对准二手散点图。
  // 延迟一拍：ECharts 首帧还没布局完就滚，会停在区块上面一半的位置。
  useEffect(() => {
    if (!focusUsed) return;
    const el = usedRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
    return () => window.clearTimeout(t);
  }, [focusUsed]);

  return (
    <div
      className={
        showHistory
          ? "mt-6 grid gap-4 lg:grid-cols-2"
          : "mt-6 grid gap-4"
      }
    >
      {showHistory && (
        <section className="rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold">新机历史价格</h2>
          {history.length ? (
            <ReactECharts option={priceOption} style={{ height: 300 }} notMerge />
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">
              历史价格收集中
            </p>
          )}
        </section>
      )}
      <section
        ref={usedRef}
        id="used-scatter"
        className={`scroll-mt-24 rounded-xl border p-5 transition ${
          focusUsed
            ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-100"
            : "border-slate-200"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-semibold">二手在售价格分布</h2>
          {focusUsed && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white">
              已定位
            </span>
          )}
        </div>
        {valid.length ? (
          <>
            <p className="mt-1 text-xs text-slate-500">
              {valid.length} 条样本 · 中位价 ¥{mid}
            </p>
            <ReactECharts
              option={scatterOption}
              style={{ height: 300 }}
              notMerge
            />
          </>
        ) : (
          <p className="py-16 text-center text-sm text-slate-500">
            二手样本收集中
          </p>
        )}
      </section>
    </div>
  );
}
