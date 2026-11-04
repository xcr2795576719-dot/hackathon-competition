import type { Metadata, Viewport } from "next";
import "./globals.css";
import ScrollProgress from "@/components/motion/ScrollProgress";
import AssistantWidget from "@/components/assistant/AssistantWidget";

export const metadata: Metadata = {
  title: "机鉴 · 数码行情与避坑决策平台",
  description: "查行情 · 拍照验机 · AI 读评测 —— 一页报告告诉你这台机器买值不值、有没有坑。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * 在首屏绘制前给 <html> 打上 .js 标记：
 * 入场揭示的"先隐藏"只在有这个类时生效，避免脚本失败导致内容永久隐形。
 * 偏好减少动效的用户直接不加类，页面保持静态。
 */
const motionBoot = `(function(){try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('js')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <script dangerouslySetInnerHTML={{ __html: motionBoot }} />
        <ScrollProgress />
        {children}
        <AssistantWidget />
      </body>
    </html>
  );
}
