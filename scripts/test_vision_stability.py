#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_vision_stability.py —— 识机提示词回归（泳道3 / 队员 E）

做三件事：
  1. 从 docs/prompts/verify.md 抽出当前提示词正文（保证测的就是线上那版）
  2. 对 3 张测试图（完好 / 轻划痕 / 重损）各跑 3 次视觉模型
  3. 算 condition_score 极差，≤10 判稳定；输出 JSON + Markdown 报告

用法：
  python scripts/test_vision_stability.py
  python scripts/test_vision_stability.py --models qwen3-vl-plus
  python scripts/test_vision_stability.py --models glm-4v-flash,qwen3-vl-plus
"""

import argparse
import base64
import json
import pathlib
import re
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "docs" / "prompts" / "test-images"
OUT_JSON = ROOT / "docs" / "prompts" / "verify-regression.json"
OUT_MD = ROOT / "docs" / "prompts" / "verify-regression.md"
CST = timezone(timedelta(hours=8))

DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
GLM_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

CASES = [
    ("T1 完好机", "pristine.jpg"),
    ("T2 轻划痕", "scratched.jpg"),
    ("T3 重损", "cracked.jpg"),
]


def load_env():
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


def load_prompt():
    """从 verify.md 里抽第一个 ```text 代码块。"""
    text = (ROOT / "docs" / "prompts" / "verify.md").read_text(encoding="utf-8")
    m = re.search(r"```text\s*([\s\S]*?)```", text)
    if not m:
        raise SystemExit("verify.md 里没找到 ```text 提示词代码块")
    return m.group(1).strip()


def parse_json_loose(text):
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


def call_vision(model, prompt, image_b64, env):
    if model.startswith("glm"):
        url, key = GLM_URL, env.get("ZHIPU_KEY", "")
    else:
        url, key = DASHSCOPE_URL, env.get("DASHSCOPE_KEY", "")
    if not key:
        return None, "missing key"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + image_b64}},
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 800,
    }
    try:
        r = requests.post(url, headers={"Authorization": "Bearer " + key}, json=payload, timeout=90)
        if r.status_code != 200:
            return None, f"HTTP {r.status_code} {r.text[:160]}"
        text = r.json()["choices"][0]["message"]["content"]
        return text, None
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="qwen3-vl-plus", help="逗号分隔，默认 qwen3-vl-plus")
    ap.add_argument("--runs", type=int, default=3)
    args = ap.parse_args()

    env = load_env()
    prompt = load_prompt()
    models = [m.strip() for m in args.models.split(",") if m.strip()]

    report = {
        "generated_at": datetime.now(CST).isoformat(timespec="seconds"),
        "prompt_version": "v2.1",
        "prompt_sha": __import__("hashlib").sha256(prompt.encode("utf-8")).hexdigest()[:12],
        "runs_per_image": args.runs,
        "models": {},
    }

    for model in models:
        print(f"\n===== {model} =====")
        model_rec = {"cases": {}, "error": None}
        for label, filename in CASES:
            path = IMG_DIR / filename
            if not path.exists():
                model_rec["cases"][label] = {"error": f"缺图 {filename}"}
                print(f"{label}: 缺图 {filename}")
                continue
            b64 = base64.b64encode(path.read_bytes()).decode()
            runs = []
            for i in range(args.runs):
                text, err = call_vision(model, prompt, b64, env)
                data = parse_json_loose(text) if text else None
                runs.append({"raw": text, "json": data, "error": err})
                score = (data or {}).get("condition_score")
                print(f"{label} #{i + 1}: score={score} err={err or '-'}")
                time.sleep(1.2)

            scores = [r["json"].get("condition_score") for r in runs if isinstance(r.get("json"), dict)]
            scores = [s for s in scores if isinstance(s, (int, float))]
            confs = [r["json"].get("confidence") for r in runs if isinstance(r.get("json"), dict)]
            confs = [s for s in confs if isinstance(s, (int, float))]
            spread = (max(scores) - min(scores)) if len(scores) >= 2 else None
            model_rec["cases"][label] = {
                "file": filename,
                "runs": runs,
                "condition_scores": scores,
                "condition_spread": spread,
                "confidence": confs,
                "stable": spread is not None and spread <= 10,
            }
            if len(scores) == 0:
                model_rec["error"] = runs[0].get("error") if runs else "no data"
        report["models"][model] = model_rec

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Markdown 汇总
    lines = [
        "# 识机稳定性回归报告",
        "",
        f"- 生成时间：{report['generated_at']}",
        f"- 提示词：docs/prompts/verify.md {report['prompt_version']}（sha {report['prompt_sha']}）",
        f"- 每图运行：{args.runs} 次；temperature=0",
        "- 判定：同一张图 condition_score 极差 ≤10 即稳定",
        "",
    ]
    for model, rec in report["models"].items():
        lines.append(f"## {model}")
        lines.append("")
        if rec.get("error") and not any(c.get("condition_scores") for c in rec["cases"].values()):
            lines.append(f"**调用失败**：{rec['error']}")
            lines.append("")
            continue
        lines.append("| 用例 | 图片 | condition_score | 极差 | 结论 | 备注 |")
        lines.append("|---|---|---|---|---|---|")
        for label, c in rec["cases"].items():
            if "error" in c and "condition_scores" not in c:
                lines.append(f"| {label} | {c.get('file', '-')} | - | - | 缺图 | {c['error']} |")
                continue
            scores = c.get("condition_scores", [])
            spread = c.get("condition_spread")
            verdict = "✅ 稳定" if c.get("stable") else "❌ 不稳定"
            note = ""
            if scores:
                note = f"分数 {scores}"
            lines.append(f"| {label} | {c.get('file', '-')} | {scores} | {spread if spread is not None else '-'} | {verdict} | {note} |")
        lines.append("")

    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n写出 {OUT_JSON}")
    print(f"写出 {OUT_MD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
