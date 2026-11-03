// scripts/make_submit_zip.mjs —— 旧入口，保留 npm run submit 兼容。
// 实际打包交给 make_submit_zip.py：Windows 自带 tar 处理中文路径会坏，Python zipfile 不会。
import { execFileSync } from "node:child_process";

execFileSync("python", ["scripts/make_submit_zip.py"], { stdio: "inherit" });
