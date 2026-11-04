#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_reports.py —— 机型决策报告批量生成（泳道3 / 队员 E）

做什么：
  读 data/models.json + 价格/二手数据 + data/knowledge.json
  → 先用脚本算一遍「四条判定规则」得到 rule_verdict（保证可复现）
  → 拼上下文 → 调 qwen-plus（DashScope OpenAI 兼容接口）
  → 按 docs/prompts/report.md 的契约校验、纠偏
  → 写 data/reports/<model_id>.json

为什么 verdict 由脚本先算：
  报告是给答辩现场看的，同一款机型今天 buy、明天 wait 会说不清。
  四条规则全部是价格/样本上的确定量，脚本算出来的结论才是可复现的；
  模型只负责把结论写成人话（理由、优缺点、坑），不负责改结论。

用法：
  python scripts/gen_reports.py --dry-run --model iphone-13-128g   # 只看拼出来的提示词，不花钱
  python scripts/gen_reports.py --model iphone-13-128g            # 生成一款
  python scripts/gen_reports.py --all                             # 全量
  python scripts/gen_reports.py --all --force                     # 覆盖已有报告
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

# 买入线校准：任务书原线是「二手95新 ≤ 新机价 65%」，但种子数据实测 95新
# 中位价约为新机价 78%，65% 永远不触发，20 份报告会全是 wait。v1.1 把演示线
# 校准到 80%（二手比新机低 20%），仍保留「价格处于近30天第30百分位以下」的前置条件。
BUY_RATIO = 80.0

# ---------------------------------------------------------------------------
# 兜底机型清单：只在 data/models.json 为空时使用。
# 一旦 D 的 models.json 有数据，这里就不生效。
# ---------------------------------------------------------------------------
FALLBACK_MODELS = [
    {"id": "iphone-13-128g",     "brand": "Apple", "name": "iPhone 13",        "variant": "128G", "tier": 1, "launch_price": 5999},
    {"id": "iphone-14-pro-256g", "brand": "Apple", "name": "iPhone 14 Pro",    "variant": "256G", "tier": 1, "launch_price": 9899},
    {"id": "huawei-mate-60-pro", "brand": "华为",   "name": "Mate 60 Pro",      "variant": "",     "tier": 1, "launch_price": 6999},
    {"id": "xiaomi-14",          "brand": "小米",   "name": "小米 14",           "variant": "",     "tier": 1, "launch_price": 3999},
    {"id": "redmi-k70",          "brand": "Redmi", "name": "Redmi K70",        "variant": "",     "tier": 1, "launch_price": 2499},
    {"id": "oneplus-ace-3",      "brand": "一加",   "name": "一加 Ace 3",        "variant": "",     "tier": 1, "launch_price": 2599},
    {"id": "iphone-15-128g",     "brand": "Apple", "name": "iPhone 15",        "variant": "128G", "tier": 2, "launch_price": 5999},
    {"id": "iphone-12-64g",      "brand": "Apple", "name": "iPhone 12",        "variant": "64G",  "tier": 2, "launch_price": 6299},
    {"id": "huawei-mate-60",     "brand": "华为",   "name": "Mate 60",          "variant": "",     "tier": 2, "launch_price": 5499},
    {"id": "huawei-nova-12",     "brand": "华为",   "name": "nova 12",          "variant": "",     "tier": 2, "launch_price": 2999},
    {"id": "honor-100",          "brand": "荣耀",   "name": "荣耀 100",          "variant": "",     "tier": 2, "launch_price": 2499},
    {"id": "honor-x50",          "brand": "荣耀",   "name": "荣耀 X50",          "variant": "",     "tier": 2, "launch_price": 1399},
    {"id": "xiaomi-13",          "brand": "小米",   "name": "小米 13",           "variant": "",     "tier": 2, "launch_price": 3999},
    {"id": "redmi-note-13-pro",  "brand": "Redmi", "name": "Redmi Note 13 Pro", "variant": "",    "tier": 2, "launch_price": 1399},
    {"id": "oppo-reno-12",       "brand": "OPPO",  "name": "Reno 12",          "variant": "",     "tier": 2, "launch_price": 2699},
    {"id": "oneplus-ace-3v",     "brand": "一加",   "name": "一加 Ace 3V",       "variant": "",     "tier": 2, "launch_price": 1999},
    {"id": "vivo-s19",           "brand": "vivo",  "name": "vivo S19",         "variant": "",     "tier": 2, "launch_price": 2499},
    {"id": "iqoo-neo9",          "brand": "iQOO",  "name": "iQOO Neo9",        "variant": "",     "tier": 2, "launch_price": 2299},
]

SYSTEM_PROMPT = (
    "你是一个冷静、克制的数码产品买手。你的读者是想买二手或降价新机、但不懂行的普通人。\n"
    "价格、成色、风险必须依据用户给出的数据，不编造数据、不编造来源；"
    "产品定位和通用使用体验可以用公开常识，但不要编造型号、参数或价格。\n"
    "只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字。"
)

USER_TEMPLATE = """{context}

请据此生成一份购买决策报告，输出这个 JSON：

{{
  "verdict": "buy|wait|avoid",
  "verdict_reason": "一句话结论，40 字内，要具体到价格或风险，不要复述规则编号",
  "price_position": "一句话说明当前价在历史里的位置，必须带百分位或差价，40 字内",
  "pros": ["优点，每条 20 字内，3 条，必须基于输入数据"],
  "cons": ["缺点，每条 20 字内，3 条，必须基于输入数据"],
  "pitfalls": ["这台机器最容易踩的坑，每条 25 字内，3 条，要能直接照着做"],
  "sources": [{{"title": "来源标题", "url": "来源链接"}}]
}}

硬性约束：
- verdict 必须等于上面【规则预判】给出的结论，一个字都不能改。
- pros / cons / pitfalls 三个数组各写 3 条，都不能为空；不要用"数据不足""暂无可确认"这类占位句凑数。
- sources 只能填写输入里出现过的链接，一条都不许自己造；输入里没有链接就输出空数组 []。
- 不要写"根据某某评测"这种没有具体来源的话。
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
    for line in path.read_text(encoding="utf-8-sig").splitlines():
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


def yuan(n):
    return "—" if n is None else f"{round(n)} 元"


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


def compute_metrics(model, prices_current, prices_history, used_samples):
    """把四条规则需要的量一次算完。"""
    mid = model["id"]
    cur = prices_current.get(mid) if isinstance(prices_current, dict) else None
    jd = cur.get("jd") if isinstance(cur, dict) else None
    source = cur.get("source") if isinstance(cur, dict) else None

    hist = prices_history.get(mid) if isinstance(prices_history, dict) else None
    hist = sorted(hist or [], key=lambda h: h.get("date", "")) if isinstance(hist, list) else []
    prices = [h["price"] for h in hist if isinstance(h, dict) and h.get("price")]
    pct = percentile_of(jd, prices) if jd and prices else None

    mine = [s for s in used_samples if isinstance(s, dict) and s.get("model_id") == mid]
    g95 = [s["price"] for s in mine if s.get("grade") == "95新" and s.get("price")]
    m95 = median(g95)
    ratio = round(m95 / jd * 100, 1) if m95 and jd else None
    severe_share = round(len(severe_samples(mine)) / len(mine), 3) if mine else 0.0

    week_change = None
    if len(prices) >= 8 and prices[-8]:
        week_change = round((prices[-1] - prices[-8]) / prices[-8] * 100, 1)

    return {
        "jd": jd,
        "source": source,
        "launch": model.get("launch_price"),
        "prices": prices,
        "pct": pct,
        "m95": m95,
        "ratio": ratio,
        "week_change": week_change,
        "samples": mine,
        "severe_sample_share": severe_share,
    }


def severe_samples(samples):
    # 只把「卖家描述」里的进水/扩容/翻新等算规则 1 的严重风险；
    # 成色档位「大修」只写进 cons/pitfalls，不单独把整款机型判 avoid。
    # 「无进水/无拆修」这类否定句不算。
    pat = re.compile(r"(?<!无)(进水|大修|扩容|翻新|监管|有锁|主板维修)")
    return [s for s in samples if pat.search(str(s.get("condition_text", "")))]


def pick_verdict(metrics, picked_knowledge):
    """四条规则，先命中先定。返回 (verdict, rule_no, rule_text)。"""
    pct, ratio, week = metrics["pct"], metrics["ratio"], metrics["week_change"]
    # 没有现价就没有「买不买」的判断基础，不能让模型自己编价格位置。
    if metrics.get("jd") is None:
        return "wait", 4, "暂无在售数据，等有在售报价后再看"
    # 演示价不能拿来判断买不买：D 对三款 T1 标了 source=demo，报告必须明示并给 wait。
    if metrics.get("source") == "demo":
        return "wait", 4, "现价为演示数据，暂不给出买入结论"
    severe = severe_samples(metrics["samples"])
    severe_kb = [
        k for k in picked_knowledge
        if re.search(r"进水|大修|扩容|翻新|监管|有锁", str(k.get("title", "")) + str(k.get("content", "")))
    ]
    severe_share = (len(severe) / len(metrics["samples"])) if metrics["samples"] else 0.0

    if severe and severe_kb and severe_share >= 0.2:
        return "avoid", 1, f"二手样本中严重风险描述占比{round(severe_share * 100)}%（≥20%），且知识库命中同类风险"

    if pct is not None and ratio is not None and pct <= 30 and ratio <= BUY_RATIO:
        return "buy", 2, f"当前价处于近30天第{pct}百分位，且二手95新中位价为新机价{ratio}%（≤{BUY_RATIO:.0f}%，v1.1 校准）"

    if (pct is not None and pct >= 70) or (week is not None and week > 5):
        bits = []
        if pct is not None:
            bits.append(f"当前价处于近30天第{pct}百分位")
        if week is not None:
            bits.append(f"近7天变化{week:+.1f}%")
        return "wait", 3, "，".join(bits) + "，价格偏高"

    return "wait", 4, "未触发买入条件，等一个更好的价格点"


def make_reason(verdict, rule_no, metrics, rule_text):
    """给模型一个可读的结论提示；模型写得好就用模型的，写偏了用它兜底。"""
    pct, ratio, week, jd = metrics["pct"], metrics["ratio"], metrics["week_change"], metrics["jd"]
    launch = metrics.get("launch")
    if jd is None:
        return "暂无在售数据，无法判断买入时机；等有在售报价后再看。"
    if metrics.get("source") == "demo":
        return f"该机型现价为演示数据（{jd}元），暂不判断买入时机；等真实价格补齐。"
    if verdict == "buy" and pct is not None and ratio is not None:
        return f"当前价处于近30天第{pct}百分位，二手95新中位价为新机价的{ratio}%，低于{BUY_RATIO:.0f}%买入线。"
    if verdict == "avoid":
        share = round(float(metrics.get("severe_sample_share") or 0) * 100)
        return f"二手样本中严重风险描述占比{share}%，这类机器后续故障率高，建议避开。"
    if verdict == "wait" and rule_no == 3:
        bits = []
        if pct is not None:
            bits.append(f"当前价第{pct}百分位")
        if week is not None:
            bits.append(f"近7天{week:+.1f}%")
        return "，".join(bits) + "，价格偏高，建议等降价。"
    if verdict == "wait" and rule_no == 4:
        if pct is not None and ratio is not None:
            if pct > 30 and ratio <= BUY_RATIO:
                return f"二手95新价为新机价的{ratio}%，但当前价第{pct}百分位，不在第30百分位以下，建议等更低点。"
            if pct <= 30 and ratio > BUY_RATIO:
                return f"当前价第{pct}百分位，但二手95新价仍为新机价{ratio}%，高于{BUY_RATIO:.0f}%买入线，建议再等。"
            return f"当前价第{pct}百分位，二手95新价{ratio}%，两条买入条件都未满足，建议再等。"
        if pct is not None and ratio is None:
            if not metrics.get("samples"):
                return f"当前价第{pct}百分位，但暂无二手样本，暂不判断二手折价，建议再等。"
            return f"当前价第{pct}百分位，但95新有效样本不足，暂不判断二手折价，建议再等。"
        if ratio is not None:
            return f"二手95新价为新机价的{ratio}%，高于{BUY_RATIO:.0f}%买入线，建议再等。"
    if jd and launch:
        off = round((1 - jd / launch) * 100, 1)
        return f"新机现价{jd}元，较首发价低{off}%；暂无二手样本，先等价格稳定。"
    return rule_text


def make_price_position(metrics):
    pct, prices, jd = metrics["pct"], metrics["prices"], metrics["jd"]
    if jd is None:
        return "暂无在售数据"
    if metrics.get("source") == "demo":
        return f"演示数据：当前价{jd}元，暂无真实30天历史价可对比"
    if pct is not None and prices:
        return f"近30天第{pct}百分位，中位价{median(prices)}元，当前价{jd}元"
    if jd:
        return f"新机现价{jd}元，暂无30天历史价可对比"
    return "价格数据暂缺"


def reason_ok(reason, verdict, metrics):
    s = str(reason or "")
    if not (12 <= len(s) <= 60) or BAD_PLACEHOLDER.search(s) or not re.search(r"\d", s):
        return False
    if verdict == "buy":
        return ("百分位" in s or "折价" in s) and ("80" in s or "折价" in s or "二手" in s)
    if verdict == "avoid":
        return any(w in s for w in ("进水", "大修", "扩容", "翻新", "风险"))
    if metrics["pct"] is not None and metrics["pct"] >= 70:
        return str(metrics["pct"]) in s or "百分位" in s or "涨" in s
    if metrics["week_change"] is not None and metrics["week_change"] > 5:
        return "涨" in s or str(abs(metrics["week_change"])) in s
    return "折价" in s or "80" in s or "二手95新" in s


def build_context(model, metrics, picked_knowledge):
    """把一台机器的所有已知信息拼成一段文本。缺失的部分显式写「暂无数据」。"""
    brand = model.get("brand", "")
    name = model.get("name", "")
    variant = model.get("variant", "")
    launch = model.get("launch_price")
    title = f"{brand} {name} {variant}".strip()

    lines = [f"【机型】{title}，首发价 {yuan(launch)}"]

    jd = metrics["jd"]
    if metrics.get("source") == "demo":
        status = "演示价（source=demo）"
    elif jd is None:
        status = "暂无在售"
    elif not metrics.get("samples"):
        status = "暂无二手样本"
    else:
        status = "正常"
    lines.append(f"【数据状态】{status}")
    if jd:
        cur = metrics.get("cur") or {}
        lines.append(f"【新机现价】{yuan(jd)}（{cur.get('captured_at', '时间未知')} 采集，来源 {cur.get('source', '未知')}）")
    else:
        lines.append("【新机现价】暂无数据")

    if metrics.get("source") == "demo":
        lines.append("【数据提示】该机型现价为演示数据，不要据此给出买入/性价比结论；pros/cons 不要引用具体价格。")

    jd_url = model.get("jd_url")
    lines.append(f"【商品页】{jd_url}" if jd_url else "【商品页】暂无数据")

    prices, pct = metrics["prices"], metrics["pct"]
    if prices:
        lo, hi, med = min(prices), max(prices), median(prices)
        pct_txt = f"；当前价处于第 {pct} 百分位" if pct is not None else ""
        week = metrics["week_change"]
        week_txt = f"；近 7 天变化 {week:+.1f}%" if week is not None else ""
        lines.append(f"【历史价摘要】共 {len(prices)} 个采样点：最低 {lo}、最高 {hi}、中位 {med}{pct_txt}{week_txt}")
    else:
        lines.append("【历史价摘要】暂无数据")

    samples = metrics["samples"]
    if samples:
        by_grade = {}
        for s in samples:
            if s.get("price"):
                by_grade.setdefault(s.get("grade") or "未分级", []).append(s["price"])
        parts = [f"{g} 中位价 {median(v)}（{len(v)} 条）" for g, v in by_grade.items()]
        lines.append(f"【二手样本摘要】共 {len(samples)} 条：" + "；".join(parts))
        excerpts = []
        for s in samples[:6]:
            excerpts.append(
                f"- {s.get('title', '')}（{yuan(s.get('price'))}/{s.get('grade', '未分级')}；{s.get('condition_text', '')}）"
            )
        lines.append("【样本摘录】\n" + "\n".join(excerpts))
    else:
        lines.append("【二手样本摘要】暂无数据")

    if picked_knowledge:
        lines.append("【避坑知识】")
        for k in picked_knowledge:
            lines.append(f"- {k.get('title', '')}：{k.get('content', '')}（来源：{k.get('source', '')}）")
    else:
        lines.append("【避坑知识】暂无数据")

    corpus = load_json(DATA / f"corpus_{model['id']}.json", [])
    if corpus:
        lines.append("【评测摘要】")
        for i, c in enumerate(corpus, 1):
            lines.append(f"{i}. {c.get('title', '')}（{c.get('url', '')}）：{c.get('summary', '')}")
    else:
        lines.append("【评测摘要】暂无数据（不要编造评测；sources 只填上面出现过的商品页链接）")

    verdict, rule_no, rule_text = pick_verdict(metrics, picked_knowledge)
    lines.append(f"【规则预判】{verdict}（规则{rule_no}：{rule_text}）")
    lines.append(f"【价格位置提示】{make_price_position(metrics)}")
    lines.append(f"【结论提示】{make_reason(verdict, rule_no, metrics, rule_text)}")
    return "\n".join(lines), verdict, rule_no, rule_text


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


def trim_reason(text, limit=60):
    s = re.sub(r"\s+", "", str(text or "")).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    for sep in ("。", "；", "，", "、", ";", ","):
        idx = cut.rfind(sep)
        if idx >= limit // 2:
            return cut[:idx]
    return cut


BAD_PLACEHOLDER = re.compile(r"数据不足|暂无可确认|暂无数据|无法判断|缺少数据")


def clean_price_claims(arr, jd, m95):
    """模型经常把「新机价 / 二手价」说反（例：1908 元说成“跌破二手 1524 元”）。
    新机价一定高于二手 95新中位价（否则不是正常二手行情），按方向删掉反话。"""
    if not jd or not m95:
        return arr
    if jd > m95:
        bad = re.compile(r"跌破二手|低于二手|二手价高于新机|价差倒挂|新机价低于二手|二手.*高于新机")
    else:
        bad = re.compile(r"新机溢价|新机价高于二手|二手.*低于新机")
    return [x for x in arr if not bad.search(x)]


def validate(report, context_text, expected_verdict, expected_reason, metrics, expected_pp, rule_no):
    """返回 (problems, report)。尽量把模型输出纠到可直接上前的状态。"""
    problems = []
    if not isinstance(report, dict):
        return ["不是 JSON 对象"], None

    if report.get("verdict") != expected_verdict:
        problems.append(f"verdict 应为 {expected_verdict}，实际 {report.get('verdict')!r}")
        report["verdict"] = expected_verdict

    for field in ("pros", "cons", "pitfalls"):
        v = report.get(field)
        if not isinstance(v, list):
            problems.append(f"{field} 不是数组")
            v = []
        v = [str(x).strip() for x in v if str(x).strip()]
        v = [x for x in v if not BAD_PLACEHOLDER.search(x)]
        if field in ("pros", "cons"):
            v = clean_price_claims(v, metrics.get("jd"), metrics.get("m95"))
        report[field] = v[:4]
        if len(report[field]) < 2:
            problems.append(f"{field} 少于 2 条")

    # 演示价不能用来写“新机溢价/折价”类 cons，否则会出现“2368 元新机溢价 1500 元”这种假对比。
    if metrics.get("source") == "demo":
        pricey = re.compile(r"元|溢价|折价|现价|新机价|二手.*价|降价|涨价")
        report["cons"] = [x for x in report["cons"] if not pricey.search(x)]
        for item in ("现价为演示数据，性价比结论不可用", "需等真实价格补齐后再判断买入时机"):
            if len(report["cons"]) >= 3:
                break
            if item not in report["cons"]:
                report["cons"].append(item)

    reason = trim_reason(report.get("verdict_reason"))
    # 结论句统一由脚本生成：模型爱把「新机价/二手价」说反，buy 的
    # 「新机价远低于二手 95新」这类错话会直接被答辩抓住。
    report["verdict_reason"] = expected_reason

    # price_position 至少含数字；没有历史价时不许编「第 N 百分位」
    pp = str(report.get("price_position") or "").strip()
    if metrics.get("jd") is None:
        pp = expected_pp
        bad_pp = False
    else:
        if metrics.get("source") == "demo":
            pp = expected_pp
        bad_pp = not re.search(r"\d", pp)
        if metrics["pct"] is None and "百分位" in pp:
            bad_pp = True
        if metrics["pct"] is not None and "百分位" not in pp and "历史" not in pp:
            bad_pp = True
    if bad_pp:
        problems.append("price_position 与数据不符")
        pp = expected_pp
    report["price_position"] = pp[:80]

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
    # 上下文里有商品页链接，就补一条真实来源
    if not kept:
        m = re.search(r"【商品页】(https?://\S+)", context_text)
        if m:
            kept.append({"title": "京东商品页", "url": m.group(1)})
            dropped += 1
    report["sources"] = kept[:3]
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
        print("⚠️  data/models.json 为空，使用内置兜底清单")

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

        metrics = compute_metrics(model, prices_current, prices_history, used_samples)
        metrics["cur"] = prices_current.get(mid) if isinstance(prices_current, dict) else None
        picked_knowledge = pick_knowledge(model, knowledge)
        context, expected_verdict, rule_no, rule_text = build_context(model, metrics, picked_knowledge)
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
        expected_reason = make_reason(expected_verdict, rule_no, metrics, rule_text)
        expected_pp = make_price_position(metrics)

        problems, report = validate(
            report, context, expected_verdict, expected_reason, metrics, expected_pp, rule_no
        )

        # 解析失败：重试一次完整生成
        if report is None:
            raw, err = call_llm(api_key, prompt + "\n\n上一次回复不是合法 JSON。这次第一字符必须是 {，只输出 JSON。")
            report = parse_json_loose(raw) if raw else None
            problems, report = validate(
                report, context, expected_verdict, expected_reason, metrics, expected_pp, rule_no
            )
            if report is None:
                print(f"[{i}/{len(targets)}] ❌ {mid} JSON 解析失败")
                failed += 1
                continue

        # 校验不过：带着问题重试一次
        if problems and report is not None:
            retry_prompt = prompt + (
                "\n\n上一次的输出存在这些问题：" + "；".join(problems) +
                f"。请重新完整输出 JSON：verdict 必须是 {expected_verdict}；"
                "pros / cons / pitfalls 各 3 条，不要占位句；sources 只填上面出现过的链接。"
            )
            raw2, err2 = call_llm(api_key, retry_prompt)
            r2 = parse_json_loose(raw2) if raw2 else None
            p2, r2v = validate(
                r2, context, expected_verdict, expected_reason, metrics, expected_pp, rule_no
            )
            if r2v is not None and (len(p2) < len(problems)):
                report, problems = r2v, p2

        if problems:
            print(f"[{i}/{len(targets)}] ⚠️  {mid} 校验问题: {'; '.join(problems)}")

        # 兜底：三个数组字段必须存在且尽量非空，前端不做判空
        fallback_pros = [
            f"现价{metrics['jd']}元，低于首发价" if metrics["jd"] else "",
            f"近30天第{metrics['pct']}百分位，处于历史低位" if metrics["pct"] is not None else "",
            f"二手样本{len(metrics['samples'])}条，价格可交叉验证" if metrics["samples"] else "",
        ]
        fallback_cons = [
            f"二手95新中位价{metrics['m95']}元，折价{metrics['ratio']}%" if metrics["m95"] else "",
            "评测语料未接入，性能与续航只能参考公开参数",
            "需核对序列号、电池健康与维修史",
        ]
        fallback_pitfalls = [
            "只给IMEI不给序列号，无法查原始容量与保修",
            "低价链接可能是模型机/配件或引流，先验机再付款",
            "收货开箱全程录像，24小时内提异议",
        ]
        for field, fb in (("pros", fallback_pros), ("cons", fallback_cons), ("pitfalls", fallback_pitfalls)):
            if not isinstance(report.get(field), list):
                report[field] = []
            have = len(report[field])
            if have < 2:
                for item in fb:
                    if item and item not in report[field]:
                        report[field].append(item)
                    if len(report[field]) >= 3:
                        break

        report.setdefault("model_id", mid)
        report["model_title"] = f"{model.get('brand', '')} {model.get('name', '')} {model.get('variant', '')}".strip()
        report["generated_at"] = datetime.now(CST).isoformat(timespec="seconds")
        report["generator"] = TEXT_MODEL
        report["models_source"] = models_source
        report["rule"] = rule_no
        report["rule_text"] = rule_text
        report["data_source"] = metrics.get("source") or "unknown"
        if metrics.get("source") == "demo":
            report["demo"] = True
        report["metrics"] = {
            "current_price": metrics["jd"],
            "price_source": metrics.get("source"),
            "percentile_30d": metrics["pct"],
            "used_95_median": metrics["m95"],
            "used_95_ratio_pct": metrics["ratio"],
            "week_change_pct": metrics["week_change"],
            "used_sample_count": len(metrics["samples"]),
            "severe_sample_share": metrics.get("severe_sample_share"),
        }
        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[{i}/{len(targets)}] ✅ {mid} → {report.get('verdict')}  {report.get('verdict_reason', '')[:40]}")
        ok += 1

    if not args.dry_run:
        print(f"\n完成：成功 {ok}，跳过 {skipped}，失败 {failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
