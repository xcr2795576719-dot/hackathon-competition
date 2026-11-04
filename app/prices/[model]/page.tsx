import Link from "next/link";
import { notFound } from "next/navigation";
import {
  readCatalog,
  readPrices,
  demoModel,
  demoHistory,
  demoSamples,
} from "@/components/prices/data";
import FreshnessBadge from "@/components/prices/FreshnessBadge";
import PriceCharts from "@/components/prices/PriceCharts";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import InViewMount from "@/components/motion/InViewMount";
export const dynamic = "force-dynamic";
export default async function PricePage({
  params,
  searchParams,
}: {
  params: { model: string };
  // ?tab=used：从验机卡「查看二手行情曲线」跳过来，落在二手散点图
  searchParams?: { tab?: string | string[] };
}) {
  const tab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const focusUsed = tab === "used";
  const models = await readCatalog();
  const catalog = models.length ? models : [demoModel];
  const { current, history, used } = await readPrices();
  const model = catalog.find((m) => m.id === params.model);
  if (!model) notFound();
  const demo = models.length === 0;
  const price =
    current[model.id] ??
    (demo
      ? {
          jd: 4988,
          captured_at: "2026-10-30T12:00:00+08:00",
          source: "模拟数据",
        }
      : undefined);
  const hist = history[model.id] ?? [];
  const samples = demo
    ? demoSamples
    : used.filter((s) => s.model_id === model.id);
  return (
    <main className="mx-auto max-w-6xl px-5 pb-28 pt-10">
      <Link href="/" className="text-sm text-slate-500 hover:text-blue-700">
        ← 返回机型列表
      </Link>
      <Reveal className="mt-8 flex flex-wrap justify-between gap-5">
        <div>
          <p className="text-sm text-slate-500">{model.brand} / 行情</p>
          <h1 className="mt-2 text-3xl font-bold">
            {model.name} {model.variant}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {model.tier === 1
              ? "深度行情"
              : model.tier === 2
                ? "行情概览"
                : "目录机型"}
          </p>
        </div>
        <Link
          href={`/report/${encodeURIComponent(model.id)}`}
          className="self-start rounded-lg border border-slate-300 px-4 py-2 text-sm"
        >
          查看报告 →
        </Link>
      </Reveal>
      {demo && (
        <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          演示数据：价格和样本为模拟数据，不代表真实行情。
        </p>
      )}
      <Reveal delay={80}>
      <section className="mt-8 rounded-xl bg-slate-900 p-6 text-white">
        <p className="text-sm text-slate-300">京东当前价</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {price && Number.isFinite(Number(price.jd))
            ? <CountUp value={Number(price.jd)} prefix="¥" />
            : "暂无数据"}
        </p>
        <div className="mt-3 text-xs">
          <FreshnessBadge capturedAt={price?.captured_at} />
          {price?.source && (
            <span className="ml-3 text-slate-400">来源：{price.source}</span>
          )}
        </div>
      </section>
      </Reveal>
      {model.tier === 3 ? (
        <p className="mt-8 text-slate-500">行情样本收集中</p>
      ) : focusUsed ? (
        // 从验机卡跳进来：不进 InViewMount（它要等滚到视口才挂载子节点，
        // 而这次的目标恰恰是「还没滚到」的二手散点图），直接挂载后自己滚过去
        <PriceCharts
          history={model.tier === 1 ? (hist.length ? hist : demo ? demoHistory : []) : []}
          samples={samples}
          showHistory={model.tier === 1}
          focusUsed
        />
      ) : (
        // T2 只有现价、没有 30 天新机曲线：只渲染二手散点
        <Reveal delay={140}>
          <InViewMount minHeight={380}>
            <PriceCharts
              history={model.tier === 1 ? (hist.length ? hist : demo ? demoHistory : []) : []}
              samples={samples}
              showHistory={model.tier === 1}
            />
          </InViewMount>
        </Reveal>
      )}
    </main>
  );
}
