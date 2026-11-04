import Link from 'next/link';
import {readCatalog, demoModel} from '@/components/prices/data';
import ModelList from '@/components/prices/ModelList';
export const dynamic = 'force-dynamic';
export default async function HomePage(){
  const models = await readCatalog();
  const catalog = models.length ? models : [demoModel];
  return (
    <main className="mx-auto max-w-6xl px-5 py-10 sm:py-16">
      <header className="border-b border-slate-200 pb-10">
        <p className="text-sm font-bold tracking-widest text-blue-700">机鉴 / 数码决策</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">看清行情，再做决定。</h1>
        <p className="mt-4 max-w-xl leading-7 text-slate-600">新机价格、二手行情与验机报告，让每一次选择都有依据。</p>
        <Link href="/verify" className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white">拍照验机 →</Link>
      </header>
      <section className="mt-10">
        {!models.length && <p className="mb-3 text-sm text-amber-700">机型数据正在录入，下方数据仅供演示。</p>}
        <ModelList models={catalog} demo={!models.length}/>
      </section>
    </main>
  );
}
