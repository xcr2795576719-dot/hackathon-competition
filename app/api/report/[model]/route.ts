// GET  /api/report/[model]  → 读缓存，没有则 404
// POST /api/report/[model]  → 用 qwen-plus 生成报告（含避坑知识+评测摘要），写缓存
import { NextResponse } from "next/server";
import { aiChat, parseJsonLoose } from "@/lib/ai";
import {
  readJson,
  writeJson,
  PATHS,
  type Model,
  type Knowledge,
  type UsedSample,
} from "@/lib/data";
import { medianPrice } from "@/lib/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: { model: string } }) {
  const id = ctx.params.model;
  try {
    const cached = readJson(PATHS.report(id));
    return NextResponse.json({ cached: true, report: cached });
  } catch {
    return NextResponse.json({ cached: false, error: "no cache" }, { status: 404 });
  }
}

export async function POST(_req: Request, ctx: { params: { model: string } }) {
  const id = ctx.params.model;

  const models = readJson<Model[]>(PATHS.models, []);
  const model = models.find((m) => m.id === id);
  if (!model) {
    return NextResponse.json({ error: `model not found: ${id}` }, { status: 404 });
  }

  // 上下文：避坑知识 + 二手在售价样本摘要
  const knowledge = readJson<Knowledge[]>(PATHS.knowledge, []);
  const used = readJson<UsedSample[]>(PATHS.usedSamples, []);
  const usedOf = used.filter((u) => u.model_id === id);
  const usedMid = medianPrice(usedOf);

  const knownIssues = knowledge
    .filter((k) => k.content.includes(model.name) || k.title.includes(model.name))
    .slice(0, 10)
    .map((k) => `- ${k.title}: ${k.content}`)
    .join("\n");

  const sampleDigest = usedOf
    .slice(0, 10)
    .map((s) => `- ${s.grade} ¥${s.price} ${s.condition_text}`)
    .join("\n");

  const prompt = `你是数码评测编辑。请为下面这款手机写一份「值不值得买」决策报告，输出 JSON：

机型：${model.brand} ${model.name} ${model.variant}
首发价：¥${model.launch_price}
当前二手中位价：¥${usedMid || "（无数据）"}

避坑知识：
${knownIssues || "（暂无）"}

二手在售样本（部分）：
${sampleDigest || "（暂无）"}

输出 JSON 格式（只输出 JSON，不要任何多余文字）：
{
  "model_id": "${id}",
  "title": "${model.name} ${model.variant} 值不值得买",
  "verdict": "值得 / 谨慎 / 不推荐",
  "score": 0-100 整数,
  "summary": "100 字以内总结",
  "pros": ["优点1", "优点2", "优点3"],
  "cons": ["缺点1", "缺点2"],
  "pitfalls": ["避坑提示1", "避坑提示2"],
  "price_comment": "对当前二手价的判断",
  "generated_at": "${new Date().toISOString()}"
}`;

  const r = await aiChat([{ role: "user", content: prompt }]);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: 502 });
  }

  const parsed = parseJsonLoose(r.text);
  if (!parsed) {
    return NextResponse.json(
      { error: "AI 输出非 JSON", raw: r.text.slice(0, 500) },
      { status: 502 }
    );
  }

  writeJson(PATHS.report(id), parsed);
  return NextResponse.json({ cached: false, model_used: r.model, report: parsed });
}
