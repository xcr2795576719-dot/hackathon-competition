#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_submit_zip.py —— 生成 AI Works / 提交用源码包（Windows 中文路径安全版）

用法：npm run submit 或 python scripts/make_submit_zip.py
产出：jiijian-submit-YYYY-MM-DD.zip（自动排除 node_modules/.next/.git/.env 等）
"""

import fnmatch
import os
import pathlib
import zipfile
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
CST = timezone(timedelta(hours=8))
OUT = ROOT / f"jiijian-submit-{datetime.now(CST).date().isoformat()}.zip"

EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", "__pycache__", "logs", "out",
    ".npm-cache", ".tmp-swc", ".pnpm-store",
}
EXCLUDE_FILES = [".env", ".env.local", "*.log", "jiijian-submit-*.zip"]


def main():
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for name in filenames:
                if any(fnmatch.fnmatch(name, p) for p in EXCLUDE_FILES):
                    continue
                full = pathlib.Path(dirpath) / name
                rel = full.relative_to(ROOT).as_posix()
                z.write(full, rel)
                count += 1
    kb = round(OUT.stat().st_size / 1024)
    print(f"打包完成：{OUT.name}（{count} 个文件，{kb} KB）")
    print("已排除：" + " / ".join(sorted(EXCLUDE_DIRS)) + " / .env / *.log")


if __name__ == "__main__":
    main()
