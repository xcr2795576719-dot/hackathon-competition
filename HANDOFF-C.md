# 队员 C 交接文档（泳道2 后端 · 分支 feat/api-core）

> 交接对象：队员 D（周三接棒联调）
> 状态：第一棒完成。**五个 API 全通、真实照片 verify 实测 200、生产 build 通过、557 条真实二手数据已入库。**

## 一、已交付 API（本地 dev 全部实测）

| 方法 | 路径 | 说明 | 实测 |
|------|------|------|------|
| GET | `/api/models?tier=&brand=` | 机型目录，支持 tier/brand 过滤 | ✅ 200 |
| GET | `/api/prices/[model]` | 聚合 current + history + used 中位价 | ✅ 200（iphone-13 used 中位价 ¥1186，30 样本） |
| POST | `/api/verify` | 收 base64 图 → 识机/评成色 → JSON（glm-4v-flash 主，失败自动切 qwen3-vl-plus） | ✅ **真实照片 200**：识别出 iphone-13-128g / 8成新 / 后盖刮痕 / 置信度0.9 |
| GET/POST | `/api/report/[model]` | 读缓存 / qwen-plus 生成报告写 reports/ | ✅ 200（已生成 iphone-13-128g 缓存，评分86） |
| POST | `/api/estimate` | 估价引擎：中位价×系数±10% | ✅ 200（1186×0.85=mid ¥1008，区间 ¥907~1109） |

异常路径也已验证：`/api/prices/not-exist` → 404；`/api/verify` 喂 1×1 非法图 → 502 且自动走了 glm→qwen 双模型降级（证明降级链路通）。

## 二、关键文件（仅改泳道2目录，符合边界）

- `lib/data.ts` —— JSON 原子读写（tmp+rename）+ 路径穿越防护 + 全部类型定义
- `lib/estimate.ts` —— 五档系数（99新0.92/95新0.85/9成新0.76/8成新0.65/大修0.5）+ 拆修(-8%)/进水(-15%)/无盒(-3%) 扣减，输出 basis[] 供答辩逐项讲解
- `app/api/{models,prices/[model],verify,report/[model],estimate}/route.ts` —— 全部 `runtime="nodejs"`
- `scripts/import_used.py` —— 二手 CSV → qwen-plus 批量归一成色（20 条/批）→ 合并 used_samples.json，失败落 failed.csv
- `scripts/smoke_test.mjs` —— 五 API 冒烟脚本（本地联调用）
- `data/used_samples.json` —— **已替换为 557 条真实闲鱼数据**（来自 xianyu.zip，6 款 T1 机型）

## 三、真实二手数据入库结果（557 条）

| 机型 | 样本数 | 中位价 | 价格区间 | 五档分布 |
|------|--------|--------|----------|----------|
| iphone-13-128g | 30 | ¥1186 | 799~1388 | 99新4/95新22/9成新2/8成新1/大修1 |
| iphone-14-pro-256g | 60 | ¥2299 | 1750~2809 | 99新16/95新29/9成新9/8成新1/大修5 |
| huawei-mate60-pro | 119 | ¥1490 | 499~2499 | 99新27/95新63/9成新16/8成新7/大修6 |
| xiaomi-14 | 117 | ¥1289 | 960~1699 | 99新46/95新61/9成新6/8成新4 |
| redmi-k70 | 115 | ¥850 | 39~1098 | 99新36/95新56/9成新13/8成新4/大修6 |
| oneplus-ace3 | 116 | ¥1000 | 580~1950 | 99新19/95新45/9成新20/8成新16/大修16 |

（570 行原始，13 行因 (title,price) 重复被去重）

## 四、已知问题 / 注意

1. **Next.js 版本**：任务书写 14.2.35，但其 SWC 原生二进制（@next/swc-win32-x64-msvc）在 npm 上不存在（最高仅 14.2.33）。已统一降级到 **14.2.33**（仍属 Next.js 14+，符合技术栈约束）。
2. **import_used.py 已加鲁棒性**：qwen-plus 对长批次（>10 条）偶尔返回条数不符（如 20 行只给 19 个 grade），导致整批失败。已修复——批次失败自动**降级为逐行判定**，单行仍失败用**本地关键词规则**兜底（`heuristic_grade`），保证入库不中断。逐行模式较慢（每批失败多耗 ~40s），570 行全量约 8 分钟。
3. **二手样本多为"95新"**：qwen-plus 对标题判成色偏保守/偏高（多数卖家描述偏正面），中位价因此偏中高端。答辩时可说明这是"在售价"而非"成交价"。
4. **`.env.local` 含 key**：已 gitignore，本地联调用，切勿提交/截图。

## 五、D 接手待办

- [ ] 联调前端（泳道1B 验机/报告页）——后端 API 已全部就绪
- [ ] 如需补全 T2 机型（12 款行情机）数据，用同样流程跑 `import_used.py`
- [ ] 若想要更真实的成色分布，可让 AI 用 condition_text 全文（而非仅 title）判定——需采集端补 condition_text 列
- [ ] 真实照片再补 2 张（轻划痕/重损各一）POST `/api/verify` 验证五档边界

## 六、协作约定

- 分支 `feat/api-core`，基于 `origin/main`（commit 4a03f3b）之上，PR diff 只含本泳道改动
- 当前 remote 仅指向 Gitee（`https://gitee.com/its-a-shame/hackathon-competition`），PR 在 Gitee 侧开（base: main，head: feat/api-core）
- main 受保护，走 PR，不直推
