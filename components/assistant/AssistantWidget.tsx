"use client";

import { useEffect, useRef, useState } from "react";
import { readLastVerify, type LastVerify } from "@/lib/last-verify";

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** 本地欢迎语：只给用户看，不作为对话历史发给模型 */
  local?: boolean;
  error?: boolean;
};

const QUICK_ASKS = ["这台现在卖掉划算吗？", "修一修继续用值不值？", "要不要趁早换新机？"];

const FALLBACK_WELCOME =
  "我是机鉴 AI 助手。还没看到你的验机记录 —— 先去「拍照验机」拍一张，我就能按你的机型、成色和二手行情，告诉你该卖、该留还是该换。";

function welcomeOf(v: LastVerify | null): string {
  if (!v) return FALLBACK_WELCOME;
  const tail = v.grade
    ? `（${v.grade}，成色 ${v.condition_score} 分）`
    : `（成色 ${v.condition_score} 分）`;
  return `刚验了 ${v.model_name}${tail}？直接问我要不要现在卖掉，还是修修继续用。`;
}

/** 把 **加粗** 渲染成强调色，其余按纯文本保留换行 */
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-slate-900">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function BubbleText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) =>
        line.trim() ? (
          <p key={i} className={i === 0 ? "" : "mt-1.5"}>
            <RichLine text={line} />
          </p>
        ) : (
          <span key={i} className="block h-1.5" />
        )
      )}
    </>
  );
}

export default function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ctx, setCtx] = useState<LastVerify | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const seq = useRef(0);
  const nextId = () => ++seq.current;

  const hasUser = msgs.some((m) => m.role === "user");

  function openPanel() {
    // 每次打开都重读 localStorage：用户可能刚在 /verify 验完机
    const latest = readLastVerify();
    setCtx(latest);
    setMsgs((prev) =>
      prev.length ? prev : [{ id: nextId(), role: "assistant", content: welcomeOf(latest), local: true }]
    );
    setOpen(true);
  }

  function resetChat() {
    const latest = readLastVerify();
    setCtx(latest);
    setMsgs([{ id: nextId(), role: "assistant", content: welcomeOf(latest), local: true }]);
    setInput("");
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sending) return;

    const latest = readLastVerify();
    setCtx(latest);
    const userMsg: Msg = { id: nextId(), role: "user", content: q };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((m) => !m.local && !m.error)
            .map((m) => ({ role: m.role, content: m.content })),
          context: latest
            ? {
                model_id: latest.model_id,
                model_name: latest.model_name,
                condition_score: latest.condition_score,
                grade: latest.grade,
                defects: latest.defects,
                estimate: latest.estimate,
                current_price: latest.current_price,
              }
            : null,
        }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || typeof data?.reply !== "string" || !data.reply.trim()) {
        throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      setMsgs((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: data.reply.trim() },
      ]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: "AI 通道有点忙，这次没接通。等两秒再问一次就行。",
          error: true,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  // 新消息 / 打字中都要贴着底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 移动端面板占满屏，别让背后的页面跟着滚
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (window.innerWidth >= 640) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭 AI 助手"
            onClick={() => setOpen(false)}
            className="no-print fixed inset-0 z-40 bg-slate-900/35 sm:hidden"
          />
          <section
            role="dialog"
            aria-label="机鉴 AI 助手"
            className="no-print fixed inset-0 z-50 flex flex-col border-slate-200 bg-white sm:inset-auto sm:bottom-24 sm:right-4 sm:h-[480px] sm:w-[360px] sm:border sm:shadow-[0_24px_48px_rgba(26,26,24,0.18)]"
          >
            {/* 头 */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums text-[11px] tracking-[0.16em] text-slate-900">
                  AI ASSISTANT
                </span>
                <span className="text-sm font-medium text-slate-900">机鉴助手</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetChat}
                  className="border border-slate-200 px-1.5 py-0.5 tabular-nums text-[9px] tracking-[0.12em] text-slate-500 transition-colors duration-200 hover:border-slate-700 hover:text-slate-700"
                >
                  RESET
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="px-1.5 py-0.5 text-sm text-slate-500 transition-colors duration-200 hover:text-slate-900"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 上下文条 */}
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/40 px-3 py-1.5">
              {ctx ? (
                <p className="tabular-nums truncate text-[10px] leading-relaxed text-slate-500">
                  CTX · <span className="text-slate-700">{ctx.model_name}</span>
                  {ctx.grade ? ` · ${ctx.grade}` : ""}
                  {ctx.estimate ? ` · 估价 ¥${ctx.estimate.low}~¥${ctx.estimate.high}` : ""}
                </p>
              ) : (
                <p className="tabular-nums text-[10px] leading-relaxed text-slate-500">
                  CTX · 无验机记录 · 先去 /verify 拍照
                </p>
              )}
            </div>

            {/* 消息 */}
            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
              {msgs.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] px-2.5 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-slate-900 text-white"
                        : m.error
                          ? "border border-red-600/40 bg-red-600/10 text-red-600"
                          : "border border-slate-200 bg-slate-50/70 text-slate-700"
                    }`}
                  >
                    {m.role === "assistant" && !m.error && (
                      <p className="tabular-nums mb-1 text-[9px] tracking-[0.16em] text-slate-500">
                        机鉴 AI
                      </p>
                    )}
                    <BubbleText text={m.content} />
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="border border-slate-200 bg-slate-50/70 px-2.5 py-2">
                    <span className="tabular-nums text-[11px] text-slate-900">
                      正在按你的成色和行情算…
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 快捷问法 */}
            {!hasUser && !sending && (
              <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-slate-200 px-3 py-2">
                {QUICK_ASKS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className="border border-slate-200 px-2 py-1 text-[11px] text-slate-700 transition-colors duration-200 hover:border-slate-900 hover:text-slate-900"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* 输入 */}
            <div className="shrink-0 border-t border-slate-200 bg-slate-100 px-2.5 py-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="问点具体的：现在卖掉划算吗？"
                  className="max-h-24 min-h-9 flex-1 resize-none border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  className="h-9 bg-slate-900 px-3.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  发送
                </button>
              </div>
              <p className="tabular-nums mt-1 text-[9px] text-slate-500">
                基于验机数据回答 · 仅供参考，不构成购买建议
              </p>
            </div>
          </section>
        </>
      )}

      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="打开机鉴 AI 助手"
          className="no-print fixed bottom-5 right-4 z-50 flex h-14 w-14 items-center justify-center gap-2 rounded-full border border-slate-900 bg-slate-900 text-white shadow-[0_18px_36px_-18px_rgba(26,26,24,.5)] transition-colors duration-200 hover:bg-slate-800 sm:bottom-6 sm:right-6 sm:h-11 sm:w-auto sm:px-4"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path
              d="M11.5 3.2l1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6L5.2 9.5l4.6-1.7 1.7-4.6z"
              strokeLinejoin="round"
            />
            <path
              d="M17.6 15.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"
              strokeLinejoin="round"
            />
          </svg>
          <span className="hidden text-sm font-medium sm:inline">问AI</span>
        </button>
      )}
    </>
  );
}
