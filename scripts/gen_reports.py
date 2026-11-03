#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_reports.py —— 机型决策报告批量生成（泳道3 / 队员 E）

做什么：
  读 data/models.json + 价格/二手数据 + data/knowledge.json
  → 拼上下文 → 调 qwen-plus（DashScope OpenAI 兼容接口）
  → 按 docs/prompts/report.md 的契约校验
  → 写 data/reports/<model_id>.json

用法：
  python scripts/gen_reports.py --dry-run --model iphone-13-128g   # 只看拼出来的提示词，不花钱
  python scripts/gen_reports.py --model iphone-13-128g            # 生成一款
  python scripts/gen_reports.py --all                             # 全量
  python scripts/gen_reports.py --all --force                     # 覆盖已有报告

为什么用 requests 不用 openai SDK：
  本机只装了 requests。这里就一个 POST，没必要为它多装一个包。

注意：
  data/models.json 现在是空的（数据组长还没填），脚本会退回到内置的 18 款兜底清单，
  并在报告里标 "models_source": "fallback"。D 的数据一落盘，重跑就会自动改用真数据。
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REPORTS = DATA / "reports"
CST = timezone(timedelta(hours=8))

DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
TEXT_MODEL = "qwen-plus"

# ---------------------------------------------------------------------------
# 兜底机型清单：只在 data/models.json 为空时使用。
# 首发价是公开参考价，可能因版本/渠道略有出入；D 的 models.json 一旦有数据，这里就不再生效。
# ---------------------------------------------------------------------------
FALLBACK_MODELS = [
    {"id": "iphone-13-128g",     "brand": "Apple",   "name": "iPhone 13",        "variant": "128G", "tier": 1, "launch_price": 5999},
    {"id": "iphone-14-pro-256g", "brand": "Apple",   "name": "iPhone 14 Pro",    "variant": "256G", "tier": 1, "launch_price": 9899},
    {"id": "huawei-mate-60-pro", "brand": "华为",     "name": "Mate 60 Pro",      "variant": "",     "tier": 1, "launch_price": 6999},
    {"id": "xiaomi-14",          "brand": "小米",     "name": "小米 14",           "variant": "",     "tier": 1, "launch_price": 3999},
    {"id": "redmi-k70",          "brand": "Redmi",   "name": "Redmi K70",        "variant": "",     "tier": 1, "launch_price": 2499},
    {"id": "oneplus-ace-3",      "brand": "一加",     "name": "一加 Ace 3",        "variant": "",     "tier": 1, "launch_price": 2599},
    {"id": "iphone-15-128g",     "brand": "Apple",   "name": "iPhone 15",        "variant": "128G", "tier": 2, "launch_price": 5999},
    {"id": "iphone-12-64g",      "brand": "Apple",   "name": "iPhone 12",        "variant": "64G",  "tier": 2, "launch_price": 6299},
    {"id": "huawei-mate-60",     "brand": "华为",     "name": "Mate 60",          "variant": "",     "tier": 2, "launch_price": 5499},
    {"id": "huawei-nova-12",     "brand": "华为",     "name": "nova 12",          "variant": "",     "tier": 2, "launch_price": 2999},
    {"id": "honor-100",          "brand": "荣耀",     "name": "荣耀 100",          "variant": "",     "tier": 2, "launch_price": 2499},
    {"id": "honor-x50",          "brand": "荣耀",     "name": "荣耀 X50",          "variant": "",     "tier": 2, "launch_price": 1399},
    {"id": "xiaomi-13",          "brand": "小米",     "name": "小米 13",           "variant": "",     "tier": 2, "launch_price": 3999},
    {"id": "redmi-note-13-pro",  "brand": "Redmi",   "name": "Redmi Note 13 Pro", "variant": "",    "tier": 2, "launch_price": 1399},
    {"id": "oppo-reno-12",       "brand": "OPPO",    "name": "Reno 12",          "variant": "",     "tier": 2, "launch_price": 2699},
    {"id": "oneplus-ace-3v",     "brand": "一加",     "name": "一加 Ace 3V",       "variant": "",     "tier": 2, "launch_price": 1999},
    {"id": "vivo-s19",           "brand": "vivo",    "name": "vivo S19",         "variant": "",     "tier": 2, "launch_price": 2499},
    {"id": "iqoo-neo9",          "brand": "iQOO",    "name": "iQOO Neo9",        "variant": "",     "tier": 2, "launch_price": 2299},
]

SYSTEM_PROMPT = (
    "你是一个冷静、克制的数码产品买手。你的读者是想买二手或降价新机、但不懂行的普通人。\n"
    "你只依据用户给出的数据做判断，不补充任何外部知识，不编造数据、不编造来源。\n"
    "只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字。"
)

USER_TEMPLATE = """{context}

请据此生成一份购买决策报告，输出这个 JSON：

{{
  "verdict": "buy|wait|avoid",
  "verdict_reason": "一句话结论，40 字内，要具体到价格或风险",
  "price_position": "一句话说明当前价在历史里的位置，例如：近30天第32百分位，比中位价低8%",
  "pros": ["优点，每条 20 字内，2-3 条，至少 1 条"],
  "cons": ["缺点，每条 20 字内，2-3 条，至少 1 条"],
  "pitfalls": ["这台机器最容易踩的坑，每条 25 字内，2-3 条，至少 1 条"],
  "sources": [{{"title": "来源标题", "url": "来源链接"}}]
}}

判定规则（按顺序执行，先命中先定）：
1. 命中任一"严重风险"知识条目（进水/大修/扩容/翻新）且二手样本里该机型有对应描述 → verdict = "avoid"。
2. 当前价处于近 30 天第 30 百分位以下，且二手 95新中位价 ≤ 新机现价的 65% → verdict = "buy"。
3. 当前价处于第 70 百分位以上，或近 7 天涨幅 > 5% → verdict = "wait"。
4. 其余情况 → verdict = "wait"，并在 verdict_reason 里说明"等一个更好的价格点"。

硬性约束：
- pros / cons / pitfalls 三个数组**都不能为空**，每个至少 1 条。数据不足时写"暂无可确认的优点（数据不足）"这类占位，不要输出空数组。
- sources 只能填写输入里出现过的链接，一条都不许自己造。输入里没有链接就输出空数组 []。
- 不要写"根据某某评测"这种没有具体来源的话。
- 数据缺失时不要用行业经验补齐，直接在 verdict_reason 或 cons 里写"数据不足"。
- 所有价格单位是人民币元，不要换算。"""


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def load_env():
    """极简 .env 解析：KEY=VALUE，忽略注释与空行。"""
    env = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def median(nums):
    if not nums:
        return None
    s = sorted(nums)
    n = len(s)
    return s[n // 2] if n % 2 else round((s[n // 2 - 1] + s[n // 2]) / 2)


def percentile_of(value, series):
    """value 在 series 里处于第几百分位（0=最低）。"""
    if not series or value is None:
        return None
    below = sum(1 for x in series if x <= value)
    return round(below / len(series) * 100)


# ---------------------------------------------------------------------------
# 上下文拼装
# ---------------------------------------------------------------------------
def pick_knowledge(model, knowledge, limit=6):
    """按机型关键词命中程度挑知识条目，命不中就补通用条目。"""
    tokens = [t for t in [model.get("brand"), model.get("name"), model.get("variant")] if t]
    scored = []
    for k in knowledge:
        blob = (k.get("title", "") + k.get("content", ""))
        score = sum(1 for t in tokens if t and t in blob)
        scored.append((score, k.get("id", ""), k))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [k for _, _, k in scored[:limit]]


def build_context(model, prices_current, prices_history, used_samples, knowledge):
    """把一台机器的所有已知信息拼成一段文本。缺失的部分必须显式写「暂无数据」。"""
    mid = model["id"]
    brand = model.get("brand", "")
    name = model.get("name", "")
    variant = model.get("variant", "")
    launch = model.get("launch_price")
    title = f"{brand} {name} {variant}".strip()

    lines = [f"【机型】{title}，首发价 {launch if launch else '未知'} 元"]

    # --- 新机现价 ---
    cur = prices_current.get(mid) if isinstance(prices_current, dict) else None
    if cur and cur.get("jd"):
        lines.append(
            f"【新机现价】{cur['jd']} 元（{cur.get('captured_at', '时间未知')} 采集，"
            f"来源 {cur.get('source', '未知')}）"
        )
    else:
        lines.append("【新机现价】暂无数据")

    # --- 历史价 ---
    hist = prices_history.get(mid) if isinstance(prices_history, dict) else None
    hist_prices = [h["price"] for h in hist if isinstance(h, dict) and h.get("price")] if hist else []
    if hist_prices:
        lo, hi, med = min(hist_prices), max(hist_prices), median(hist_prices)
        cur_price = cur.get("jd") if cur else None
        pct = percentile_of(cur_price, hist_prices) if cur_price else None
        pct_txt = f"，当前价处于第 {pct} 百分位" if pct is not None else ""
        lines.append(
            f"【历史价摘要】共 {len(hist_prices)} 个采样点：最低 {lo}、最高 {hi}、中位 {med}{pct_txt}"
        )
    else:
        lines.append("【历史价摘要】暂无数据")

    # --- 二手样本 ---
    mine = [s for s in used_samples if isinstance(s, dict) and s.get("model_id") == mid]
    if mine:
        by_grade = {}
        for s in mine:
            if s.get("price"):
                by_grade.setdefault(s.get("grade") or "未分级", []).append(s["price"])
        parts = [f"{g} 中位价 {median(v)}（{len(v)} 条）" for g, v in by_grade.items()]
        lines.append(f"【二手样本摘要】共 {len(mine)} 条：" + "；".join(parts))
    else:
        lines.append("【二手样本摘要】暂无数据")

    # --- 知识条目 ---
    picked = pick_knowledge(model, knowledge)
    if picked:
        lines.append("【避坑知识】")
        for k in picked:
            lines.append(f"- {k.get('title', '')}：{k.get('content', '')}（来源：{k.get('source', '')}）")
    else:
        lines.append("【避坑知识】暂无数据")

    # --- 评测摘要 ---
    corpus = load_json(DATA / f"corpus_{mid}.json", [])
    if corpus:
        lines.append("【评测摘要】")
        for i, c in enumerate(corpus, 1):
            lines.append(f"{i}. {c.get('title', '')}（{c.get('url', '')}）：{c.get('summary', '')}")
    else:
        lines.append("【评测摘要】暂无数据（没有可引用的评测来源，sources 请输出空数组）")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 调模型
# ---------------------------------------------------------------------------
def call_llm(api_key, user_prompt, model=TEXT_MODEL, retries=2, max_tokens=1600):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    last_err = ""
    for attempt in range(retries + 1):
        try:
            r = requests.post(
                DASHSCOPE_URL,
                headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=120,
            )
            if r.status_code == 200:
                text = r.json()["choices"][0]["message"]["content"]
                return text, None
            last_err = f"HTTP {r.status_code} {r.text[:200]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        if attempt < retries:
            time.sleep(2 * (attempt + 1))
    return None, last_err


def parse_json_loose(text):
    """剥 ```json 包裹，截取第一个 { 到最后一个 }。"""
    if not text:
        return None
    s = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.I)
    if m:
        s = m.group(1).strip()
    a, b = s.find("{"), s.rfind("}")
    if a >= 0 and b > a:
        s = s[a:b + 1]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# 校验（对应 docs/prompts/report.md 第五节）
# ---------------------------------------------------------------------------
def validate(report, context_text):
    problems = []
    if not isinstance(report, dict):
        return ["不是 JSON 对象"], None

    if report.get("verdict") not in ("buy", "wait", "avoid"):
        problems.append(f"verdict 非法: {report.get('verdict')!r}")

    for field in ("pros", "cons", "pitfalls"):
        v = report.get(field)
        if not isinstance(v, list) or not v:
            problems.append(f"{field} 为空或不是数组")

    reason = report.get("verdict_reason") or ""
    if not isinstance(reason, str) or not reason.strip():
        problems.append("verdict_reason 为空")
    elif len(reason) > 60:
        report["verdict_reason"] = reason[:60]

    # sources 必须是真实存在于上下文里的链接
    srcs = report.get("sources")
    if not isinstance(srcs, list):
        srcs = []
    kept, dropped = [], 0
    for s in srcs:
        if not isinstance(s, dict):
            dropped += 1
            continue
        url = (s.get("url") or "").strip()
        if url and url in context_text:
            kept.append({"title": s.get("title") or url, "url": url})
        else:
            dropped += 1
    report["sources"] = kept
    if dropped:
        report["sources_trimmed"] = True

    return problems, report


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="批量生成机型决策报告")
    ap.add_argument("--model", action="append", default=[], help="指定 model_id，可重复")
    ap.add_argument("--all", action="store_true", help="生成全部机型")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的报告")
    ap.add_argument("--dry-run", action="store_true", help="只打印提示词，不调用 API")
    ap.add_argument("--limit", type=int, default=0, help="最多生成几份（调试用）")
    args = ap.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)

    models = load_json(DATA / "models.json", [])
    models_source = "models.json"
    if not models:
        models = FALLBACK_MODELS
        models_source = "fallback"
        print("⚠️  data/models.json 为空，使用内置兜底清单（18 款）")

    prices_current = load_json(DATA / "prices_current.json", {})
    prices_history = load_json(DATA / "prices_history.json", {})
    used_samples = load_json(DATA / "used_samples.json", [])
    knowledge = load_json(DATA / "knowledge.json", [])

    # 选机型
    if args.model:
        wanted = set(args.model)
        targets = [m for m in models if m["id"] in wanted]
        missing = wanted - {m["id"] for m in targets}
        if missing:
            print(f"❌ 找不到机型: {', '.join(sorted(missing))}")
            return 1
    elif args.all:
        targets = models
    else:
        ap.error("必须指定 --all 或 --model <id>")

    if args.limit:
        targets = targets[: args.limit]

    env = load_env()
    api_key = env.get("DASHSCOPE_KEY") or os.environ.get("DASHSCOPE_KEY", "")
    if not args.dry_run and not api_key:
        print("❌ 缺少 DASHSCOPE_KEY：检查仓库根目录的 .env")
        return 1

    ok, skipped, failed = 0, 0, 0
    for i, model in enumerate(targets, 1):
        mid = model["id"]
        out_path = REPORTS / f"{mid}.json"
        if out_path.exists() and not args.force:
            print(f"[{i}/{len(targets)}] {mid} 已存在，跳过（--force 覆盖）")
            skipped += 1
            continue

        context = build_context(model, prices_current, prices_history, used_samples, knowledge)
        prompt = USER_TEMPLATE.format(context=context)

        if args.dry_run:
            print(f"\n===== [{i}/{len(targets)}] {mid} 的提示词 =====")
            print(prompt)
            continue

        raw, err = call_llm(api_key, prompt)
        if raw is None:
            print(f"[{i}/{len(targets)}] ❌ {mid} 调用失败: {err}")
            failed += 1
            continue

        report = parse_json_loose(raw)
        problems, report = validate(report, context)

        # 校验不过：带着问题重试一次（少一次人工返工）
        if problems and report is not None:
            retry_prompt = prompt + (
                "\n\n上一次的输出存在这些问题：" + "；".join(problems) +
                "。请重新完整输出 JSON，pros / cons / pitfalls 三个数组都不能为空。"
            )
            raw2, err2 = call_llm(api_key, retry_prompt)
            r2 = parse_json_loose(raw2) if raw2 else None
            p2, r2v = validate(r2, context)
            if r2v is not None and (len(p2) < len(problems)):
                report, problems = r2v, p2

        if problems:
            print(f"[{i}/{len(targets)}] ⚠️  {mid} 校验问题: {'; '.join(problems)}")
            if report is None:
                failed += 1
                continue
            report["needs_review"] = True
            report["validation_issues"] = problems

        # 兜底：三个数组字段必须存在，前端不做判空
        for field in ("pros", "cons", "pitfalls"):
            if not isinstance(report.get(field), list):
                report[field] = []

        report.setdefault("model_id", mid)
        report["model_title"] = f"{model.get('brand', '')} {model.get('name', '')} {model.get('variant', '')}".strip()
        report["generated_at"] = datetime.now(CST).isoformat(timespec="seconds")
        report["generator"] = TEXT_MODEL
        report["models_source"] = models_source
        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[{i}/{len(targets)}] ✅ {mid} → {report.get('verdict')}  {report.get('verdict_reason', '')[:30]}")
        ok += 1

    if not args.dry_run:
        print(f"\n完成：成功 {ok}，跳过 {skipped}，失败 {failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
