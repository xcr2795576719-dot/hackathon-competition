# 识机回归测试图 · 来源与许可

本目录的 3 张图用于 `scripts/test_vision_stability.py` 的识机稳定性回归。
当前是**公开素材 + 一张合成轻划痕**，不是队员 E 的真机实拍；E 补拍后替换同名文件即可，
脚本和报告不用改。

| 文件 | 用途 | 来源 | 作者 | 许可 | 改动 |
|---|---|---|---|---|---|
| `pristine.jpg` | T1 完好机 | [Back of the iPhone 13 Pro.jpg](https://commons.wikimedia.org/wiki/File:Back_of_the_iPhone_13_Pro.jpg) | Hajoon0102 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 仅缩放/重编码 |
| `cracked.jpg` | T3 重损 | [Cracked iPhone.jpg](https://commons.wikimedia.org/wiki/File:Cracked_iPhone.jpg) | Ed6767 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 仅缩放/重编码 |
| `scratched.jpg` | T2 轻划痕 | 由 `pristine.jpg` 合成 | 同上 + 脚本叠加 | CC BY-SA 4.0 | 背面叠加 3 条细划痕 + 1 处边框小磕碰 |

> 轻划痕图是合成的原因：公开图库没有可用的「同一台 iPhone 13 Pro 的轻划痕背面」；
> 合成划痕的宽度/位置可控，适合做「同一张图连跑 3 次」的稳定性回归。它不能替代
> 真机拍摄对「细微划痕 vs 污渍」的区分测试，真机照片仍需 E 在周三前补拍。
