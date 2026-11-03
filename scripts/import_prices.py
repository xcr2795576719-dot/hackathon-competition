#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""import_prices.py —— 把 data/prices.csv 入库到 data/prices_history.json 与 data/prices_current.json

用法:
    python scripts/import_prices.py
    python scripts/import_prices.py data/prices.csv

契约（见 data-seed/_id命名与CSV填写说明.md 第〇节）:
  1. CSV 四列: model_id,date,price,source；source 可省略，省略按 manual
  2. prices_history.json: { "<model_id>": [ {"date","price"}, ... ] }  按日期升序
  3. prices_current.json: { "<model_id>": {"jd","captured_at","source"} }
     取该机型最新 date 的一行；captured_at = 当天 20:00:00+08:00
  4. 与已有 JSON 深合并，按 date 去重保留最新；重复执行结果不变（幂等）
  5. model_id 不在 models.json / 日期非法 / 价格非正数 -> 写入 data/skipped.csv
  6. 原子写入（tmp + os.replace），中途失败不会写坏文件
"""

import csv
import json
import os
import sys
import tempfile
from datetime import date as _date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEFAULT_CSV = DATA / "prices.csv"


def read_json(path, default):
    if not path.exists():
        return default
    try:
        text = path.read_text(encoding="utf-8-sig").strip()
        return json.loads(text) if text else default
    except json.JSONDecodeError as exc:
        sys.exit(f"[ERROR] {path.name} is not valid JSON: {exc}")


def write_json_atomic(path, obj):
    """Write to a temp file in the same dir, then os.replace for atomic swap."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load_model_ids():
    """models.json 兼容两种形状：纯数组，或 {models:[...]} 包裹。"""
    raw = read_json(DATA / "models.json", [])
    models = raw.get("models", []) if isinstance(raw, dict) else raw
    return {str(m.get("id", "")).strip() for m in models if isinstance(m, dict)}


def clean_number(value):
    num = float(value)
    return int(num) if num == int(num) else round(num, 2)


def valid_date(text):
    """严格校验 YYYY-MM-DD，2026-13-99 这种假日期也要拦下来。"""
    try:
        _date.fromisoformat(text)
        return True
    except ValueError:
        return False


def read_csv_rows(csv_path, model_ids):
    if not csv_path.exists():
        sys.exit(f"[ERROR] CSV not found: {csv_path}")
    rows, skipped, seen = [], [], 0
    with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fields = {(name or "").strip().lower() for name in (reader.fieldnames or [])}
        if not {"model_id", "date", "price"} <= fields:
            sys.exit(f"[ERROR] header must contain model_id,date,price -> got: {reader.fieldnames}")
        for lineno, raw in enumerate(reader, start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k}
            if not any(row.values()):
                continue
            seen += 1
            mid = row.get("model_id", "")
            day = row.get("date", "")
            price = row.get("price", "")
            source = row.get("source") or "manual"
            reason = None
            if mid not in model_ids:
                reason = "model_id not in models.json"
            elif not valid_date(day):
                reason = "date must be a real YYYY-MM-DD"
            else:
                try:
                    if float(price) <= 0:
                        reason = "price must be positive"
                except ValueError:
                    reason = "price is not a number"
            if reason:
                skipped.append([lineno, mid, day, price, source, reason])
                continue
            rows.append({"model_id": mid, "date": day, "price": clean_number(price), "source": source})
    return rows, skipped, seen


def merge_history(old, rows):
    """Deep merge: same date keeps the CSV value (CSV wins)."""
    merged = {}
    for mid, series in (old or {}).items():
        if not isinstance(series, list):
            continue
        for item in series:
            if isinstance(item, dict) and "date" in item and "price" in item:
                merged.setdefault(mid, {})[str(item["date"])] = item["price"]
    for row in rows:
        merged.setdefault(row["model_id"], {})[row["date"]] = row["price"]
    return {mid: [{"date": d, "price": pts[d]} for d in sorted(pts)] for mid, pts in merged.items()}


def build_current(history, prev_current, sources):
    """Latest date of each model becomes the current price."""
    current = dict(prev_current or {})
    for mid, series in history.items():
        if not series:
            continue
        last = series[-1]
        key = (mid, last["date"])
        current[mid] = {
            "jd": last["price"],
            "captured_at": f"{last['date']}T20:00:00+08:00",
            "source": sources.get(key, (current.get(mid) or {}).get("source", "manual")),
        }
    return current


def main():
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not csv_path.is_absolute():
        csv_path = ROOT / csv_path
    csv_path = csv_path.resolve()

    model_ids = load_model_ids()
    if not model_ids:
        sys.exit("[ERROR] data/models.json has no model id, check the file first")

    rows, skipped, seen = read_csv_rows(csv_path, model_ids)
    history = merge_history(read_json(DATA / "prices_history.json", {}), rows)
    sources = {(r["model_id"], r["date"]): r["source"] for r in rows}
    current = build_current(history, read_json(DATA / "prices_current.json", {}), sources)

    write_json_atomic(DATA / "prices_history.json", history)
    write_json_atomic(DATA / "prices_current.json", current)

    skipped_path = DATA / "skipped.csv"
    if skipped:
        with skipped_path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["line", "model_id", "date", "price", "source", "reason"])
            writer.writerows(skipped)
    elif skipped_path.exists():
        skipped_path.unlink()

    points = sum(len(v) for v in history.values())
    print(f"rows read     : {seen}")
    print(f"imported      : {len(rows)}")
    print(f"skipped       : {len(skipped)}" + (f"  -> data/{skipped_path.name}" if skipped else ""))
    print(f"models        : {len(history)}  (history points: {points})")
    print(f"current built : {len(current)}")
    for mid in sorted(current):
        item = current[mid]
        print(f"  - {mid:<22} {str(item['jd']):>8}  {item['captured_at']}  {item['source']}")


if __name__ == "__main__":
    main()
