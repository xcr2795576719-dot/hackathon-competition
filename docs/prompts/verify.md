# 识机提示词 · 终版

- **当前版本**：v2.2（新增 candidates 候选列表）
- **维护**：队员 E（泳道3 AI 工程）
- **调用位置**：`lib/ai.ts` 的 `aiVision(imageB64, prompt)`，模型 `glm-4v-flash`，失败切 `qwen3-vl-plus`
- **落库位置**：`app/api/verify` 解析后直接返回前端

---

## 一、提示词正文（复制这段使用）

```text
你是数码产品验机专家。分析这张产品照片，只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。

{
  "category": "手机|耳机|相机|笔记本|平板|手表|其他",
  "model_guess": "最可能的型号名，带上容量/版本，无法判断写未知",
  "confidence": 0到100的整数,
  "candidates": [
    {"name": "最可能的型号名，带容量/版本", "confidence": 0到100的整数},
    {"name": "第二可能的型号名", "confidence": 比第一个低的整数},
    {"name": "第三可能的型号名", "confidence": 更低的整数}
  ],
  "visible_defects": [
    {
      "area": "上左|上中|上右|中左|正中|中右|下左|下中|下右|屏幕|边框|背面|镜头|接口",
      "type": "划痕|磕碰|裂纹|污渍|屏幕老化|维修痕迹|进水痕迹",
      "severity": "轻微|中等|严重",
      "detail": "一句话描述你看到的位置和程度"
    }
  ],
  "condition_score": 0到100的整数,
  "notes": "30字以内的补充判断"
}

判断规则：
1. 只写你在照片里真的看见的瑕疵。看不清、被遮挡、角度拍不到的，不要猜，也不要写"无"占位。
2. visible_defects 没有发现任何瑕疵时，输出空数组 []。
3. condition_score 按外观成色打分：95-100 无可见使用痕迹；85-94 轻微使用痕；70-84 明显划痕或小磕碰；50-69 多处划痕磕碰；0-49 碎裂、变形或明显维修痕迹。
4. area 只能是上面列出的值。整体问题用 屏幕/边框/背面/镜头/接口，局部问题用九宫格方位。
5. 照片不是数码产品时，只输出 {"error":"not_product"}。
6. 照片模糊、反光、只拍到局部时，confidence 给低分，并在 notes 里说明原因。
7. candidates 必须正好 3 条（不是 1 条、不是 2 条），按置信度从高到低排列；第一个必须和 model_guess 完全一致、confidence 与顶层 confidence 相同；三个 confidence 相加不超过 100。
8. candidates 的 name 用「品牌 + 型号 + 容量/版本」写法，例如 "iPhone 13 128G"、"小米 14 12+256G"；外观相近的型号（如 iPhone 13 / iPhone 14、Mate 60 / Mate 60 Pro）要一并列出，用户会自己点选确认。
9. 完全认不出型号时，candidates 给 3 个"可能的品类代表机型"，仍按置信度降序，不要编造容量。
```

## 二、输出字段说明

| 字段 | 类型 | 前端怎么用 |
|---|---|---|
| `category` | string | 验机卡顶部的品类标签 |
| `model_guess` | string | 与 `data/models.json` 模糊匹配，匹配不上就原样显示 |
| `confidence` | int 0-100 | 置信度进度条；`<60` 前端提示「建议补拍正面/背面」 |
| `candidates[]` | array | 候选机型卡片（v2.2）：服务端匹配 `model_id` 并补 `reference_image`，用户可点选纠正机型 |
| `visible_defects[]` | array | 瑕疵列表徽章 + 九宫格高亮 |
| `condition_score` | int 0-100 | 成色分环形图；同时按分数段映射五档（见下） |
| `notes` | string | 卡片底部灰字 |

**candidates 的服务端后处理**（`app/api/verify/route.ts` 的 `normalizeVision`）：

- 每个 `name` 复用 `model_guess → model_id` 的匹配逻辑，命中机型目录时补 `model_id` / `model_name` / `reference_image: /models/<model_id>.jpg`，未命中为 `null`；
- `model_guess` 若不在候选里，会以顶层 `confidence` 补进候选并重新按置信度降序；
- 最多返回 3 条，前端拿到 2 条以上才展示候选区。

**分数段 → 五档成色映射**（与 `data/used_samples.json` 的 `grade` 对齐）：

| condition_score | grade |
|---|---|
| 95-100 | 99新 |
| 85-94 | 95新 |
| 70-84 | 9成新 |
| 50-69 | 8成新 |
| 0-49 | 大修 |

## 三、版本记录

### v2.2（当前）— 相对 v2.1 改了 1 处

| # | 改动 | 原因 |
|---|---|---|
| 1 | 新增 `candidates` 字段（固定 3 个、置信度降序、首个与 model_guess 一致） | 单次识机准确率有天花板：iPhone 13/14 正面几乎一样。给 Top3 候选让用户自己点选纠正，比死磕单一猜测可靠 |

### v2.1 — 相对 v2 改了 5 处

| # | 改动 | 原因 |
|---|---|---|
| 1 | 删除 `"无"` 这个 type 取值，改为「没瑕疵就输出 `[]`」 | v2 允许 `type:"无"`，模型会为了凑格式编一条"无瑕疵"记录，前端渲染出一个空徽章 |
| 2 | 增加 `condition_score` 的分段定义 | v2 只说"0-100 整数"，同一台机器两次跑能差 20 分；给了锚点后波动可控 |
| 3 | 增加「只写真的看见的，不要猜」 | 模型会根据"iPhone 13"这个型号名反推"可能有电池老化"，属于编造 |
| 4 | 明确「只输出一个 JSON 对象，不要 markdown 代码块」 | glm-4v-flash 有概率包一层 ` ```json `，虽然 `parseJsonLoose` 能兜，但少一层更稳 |
| 5 | `model_guess` 要求带容量/版本 | 前端要拿它去匹配 `models.json` 的 `id`，只给"iPhone 13"匹配不到 `iphone-13-128g` |

### v2（队长给的基线，已实测）
最初版本，见 `任务书/05`。

## 四、回归结果（2026-11-03 已完成）

测试图在 `docs/prompts/test-images/`（来源与许可见同目录 `CREDITS.md`）。其中 T2 是
在 T1 原图上合成的 3 条细划痕 + 1 处边框小磕碰；T1/T3 是 Wikimedia Commons 的
CC BY-SA 4.0 公开图。**E 的真机照片还没拍，补拍后覆盖同名文件、重跑脚本即可。**

| 用例 | 图片 | 期望 | glm-4v-flash（3 次） | qwen3-vl-plus（3 次） | 结论 |
|---|---|---|---|---|---|
| T1 完好机 | `pristine.jpg` | 无瑕疵，分数 ≥95 | 98 / 98 / 98（极差 0） | 95 / 98 / 95（极差 3） | ✅ 两模型都稳定 |
| T2 轻划痕 | `scratched.jpg` | 至少 1 条轻微划痕，80-94 | 90 / 90 / 90（极差 0） | 92 / 88 / 92（极差 4） | ✅ 都识别出 2 处瑕疵 |
| T3 重损 | `cracked.jpg` | 严重瑕疵，分数 <50 | 10 / 10 / 10（极差 0） | 30 / 20 / 20（极差 10） | ✅ 都在 50 以下 |

**稳定性判定**：每张图连跑 3 次，`condition_score` 极差 ≤10 分 → 本次全部通过。
`temperature` 已固定为 0；`glm-4v-flash` 极差全为 0，`qwen3-vl-plus` 最差 10 分（T3，
刚好压线），答辩时如实说「备选通道的边界样本波动更大」。

详细逐次 JSON 见 `docs/prompts/verify-regression.json`，汇总见 `verify-regression.md`。
复跑命令：`python scripts/test_vision_stability.py --models glm-4v-flash,qwen3-vl-plus`。

**另外 3 个边界用例**（还没系统跑，答辩前补）：

| 用例 | 输入 | 期望 |
|---|---|---|
| T4 非产品 | 一张风景照 | `{"error":"not_product"}`（已手测截图，返回正确） |
| T5 模糊 | 严重失焦 | `confidence` < 40，`notes` 说明模糊 |
| T6 局部 | 只拍摄像头模组 | `area` 用 `镜头`，不要硬套九宫格 |

## 五、已知弱点（答辩时主动说，比被问出来好）

1. **细微划痕 vs 污渍**：擦得掉的灰和浅划痕在照片里几乎一样，模型会互相误判。缓解办法是提示用户在强侧光下拍。
2. **成色分主观**：同一个人两次打分都可能差 5 分，所以前端展示成"参考分"而不是"鉴定结论"。
3. **只看得见外观**：电池健康、主板维修、进水这些必须在 `notes` 里明确"照片无法判断"，不能给结论。
4. **机型识别靠外观**：iPhone 13 和 14 正面几乎一样，`confidence` 会自动偏低，这是对的。
