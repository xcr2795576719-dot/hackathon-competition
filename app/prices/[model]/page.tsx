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
export const dynamic = "force-dynamic";
export default async function PricePage({
  params,
}: {
  params: { model: string };
}) {
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
    <main className="mx-auto max-w-6xl px-5 py-10">
      <Link href="/" className="text-sm text-slate-500 hover:text-blue-700">
        ← 返回机型列表
      </Link>
      <div className="mt-8 flex flex-wrap justify-between gap-5">
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
      </div>
      {demo && (
        <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          演示数据：价格和样本为模拟数据，不代表真实行情。
        </p>
      )}
      <section className="mt-8 rounded-xl bg-slate-900 p-6 text-white">
        <p className="text-sm text-slate-300">京东当前价</p>
        <p className="mt-2 text-3xl font-semibold">
          {price && Number.isFinite(Number(price.jd))
            ? `¥${Number(price.jd).toLocaleString()}`
            : "暂无数据"}
        </p>
        <div className="mt-3 text-xs">
          <FreshnessBadge capturedAt={price?.captured_at} />
          {price?.source && (
            <span className="ml-3 text-slate-400">来源：{price.source}</span>
          )}
        </div>
      </section>
      {model.tier === 1 ? (
        <PriceCharts
          history={hist.length ? hist : demo ? demoHistory : []}
          samples={samples}
        />
      ) : model.tier === 3 ? (
        <p className="mt-8 text-slate-500">行情样本收集中</p>
      ) : null}
    </main>
  );
}
