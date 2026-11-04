import Link from 'next/link';
import {readCatalog, demoModel} from '@/components/prices/data';
import ModelList from '@/components/prices/ModelList';
import Reveal from '@/components/motion/Reveal';
export const dynamic = 'force-dynamic';
export default async function HomePage(){
  const models = await readCatalog();
  const catalog = models.length ? models : [demoModel];
  return (
    <main className="mx-auto max-w-6xl px-5 pb-28 pt-10 sm:pt-16">
      <header className="hero-parallax border-b border-slate-200 pb-10">
        <Reveal>
          <p className="text-sm font-bold tracking-widest text-blue-700">数码行情 · 拍照验机 · 决策报告</p>
        </Reveal>
        <Reveal delay={70}>
          <h1 className="mt-3 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl">机鉴</h1>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-3 text-lg text-slate-700">看清行情，再做决定。</p>
        </Reveal>
        <Reveal delay={180}>
          <p className="mt-2 max-w-xl text-sm leading-7 text-slate-500">新机价格、二手行情与验机报告，让每一次选择都有依据。</p>
        </Reveal>
        <Reveal delay={240}>
          <Link href="/verify" className="group mt-6 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
            拍照验机
            <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">→</span>
          </Link>
        </Reveal>
      </header>
      <section className="mt-10">
        {!models.length && <p className="mb-3 text-sm text-amber-700">机型数据正在录入，下方数据仅供演示。</p>}
        <ModelList models={catalog} demo={!models.length}/>
      </section>
    </main>
  );
}
