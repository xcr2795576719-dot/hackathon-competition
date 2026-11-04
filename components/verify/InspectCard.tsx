"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import {
  type VerifyResult,
  conditionGrade,
  guessModelId,
  severityStyle,
} from "./types";
import CandidatePicker from "./CandidatePicker";
import { writeLastVerify, type LastVerifyEstimate } from "@/lib/last-verify";

interface InspectCardProps {
  result: VerifyResult;
  /** 是否使用 mock 数据（API 未就绪时） */
  isMock?: boolean;
}

type Extras = {
  modelId: string;
  estimate: LastVerifyEstimate | null;
  currentPrice: number | null;
};

export default function InspectCard({ result, isMock }: InspectCardProps) {
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);
  /** 用户点选的候选名；null = 采用 AI 主猜测 */
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);

  const grade = conditionGrade(result.condition_score);
  const candidates = (result.candidates ?? []).filter((c) => Boolean(c.name));
  const picked = candidates.find((c) => c.name === pickedName) ?? null;

  // 目录口径的 id：估价可以用推导值，跳行情必须是真的 model_id
  const catalogId = picked ? picked.model_id : result.model_id ?? null;
  const fallbackId =
    !catalogId && !picked && result.model_guess ? guessModelId(result.model_guess) : null;
  const activeModelId = catalogId ?? fallbackId;
  const activeName = picked
    ? picked.model_name || picked.name
    : result.model_name || result.model_guess || "未知机型";
  const activeConfidence = picked ? picked.confidence : result.confidence;

  // 换一张照片重新识机：清空上一台的选型与估价
  useEffect(() => {
    setPickedName(null);
    setEstimate(null);
    setExtras(null);
  }, [result]);

  /**
   * 静默预取估价 + 新机现价：既喂给验机卡的默认文案，也作为 AI 助手的上下文。
   * 失败不打扰用户（估价仍可手动点按钮重试）。
   */
  useEffect(() => {
    if (!activeModelId || isMock) {
      setExtras(null);
      return;
    }
    const id = activeModelId;
    let alive = true;
    setExtras(null);
    const g = conditionGrade(result.condition_score);
    (async () => {
      const [est, prices] = await Promise.all([
        fetch("/api/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_id: id, grade: g, answers: {} }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/prices/${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (!alive) return;
      const low = Number(est?.low);
      const high = Number(est?.high);
      const mid = Number(est?.mid);
      const jd = Number(prices?.current?.jd);
      setExtras({
        modelId: id,
        estimate:
          Number.isFinite(low) && Number.isFinite(high)
            ? {
                low: Math.round(low),
                mid: Math.round(Number.isFinite(mid) ? mid : low),
                high: Math.round(high),
              }
            : null,
        currentPrice: Number.isFinite(jd) && jd > 0 ? Math.round(jd) : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [activeModelId, result.condition_score, isMock]);

  /**
   * 写「最近一次验机」给全站 AI 助手（localStorage，24 小时过期）。
   * 未点选时按主猜测写入，用户不点候选也有上下文。
   */
  useEffect(() => {
    if (isMock) return;
    const id = activeModelId;
    if (!id) return;
    const matched = extras && extras.modelId === id ? extras : null;
    writeLastVerify({
      model_id: id,
      model_name: activeName,
      condition_score: result.condition_score,
      grade: conditionGrade(result.condition_score),
      defects: result.visible_defects.map((d) => ({
        area: d.area,
        type: d.type,
        severity: d.severity,
      })),
      estimate: matched?.estimate ?? null,
      current_price: matched?.currentPrice ?? null,
    });
  }, [isMock, activeModelId, activeName, result, extras]);

  const gaugeOption: EChartsOption = {
    series: [
      {
        type: "gauge",
        startAngle: 90,
        endAngle: -270,
        radius: "92%",
        center: ["50%", "50%"],
        pointer: { show: false },
        progress: {
          show: true,
          overlap: false,
          roundCap: true,
          clip: false,
          itemStyle: {
            color:
              result.condition_score >= 85
                ? "#16a34a"
                : result.condition_score >= 70
                  ? "#f59e0b"
                  : "#dc2626",
          },
        },
        axisLine: { lineStyle: { width: 12, color: [[1, "#e2e8f0"]] } },
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, 0],
          fontSize: 30,
          fontWeight: "bold",
          formatter: "{value}",
          color: "#0f172a",
        },
        title: {
          offsetCenter: [0, "42%"],
          fontSize: 12,
          color: "#64748b",
        },
        data: [
          {
            value: result.condition_score,
            name: conditionGrade(result.condition_score),
          },
        ],
      },
    ],
  };

  async function handleEstimate() {
    setEstimating(true);
    setEstimate(null);
    // 契约：POST /api/estimate { model_id, grade, answers } → { low, mid, high, basis[] }
    // 验机卡只有成色分，answers 暂空（完整问卷版后续接）
    // 用户点选过候选就用所选机型的 id，否则沿用后端回填的 model_id
    const modelId = activeModelId;
    // AI 没认出目录机型 → 直接说明，不再白打一次请求
    if (!modelId) {
      setEstimate("该机型暂无二手样本，估价等数据入库后开放");
      setEstimating(false);
      return;
    }
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: modelId,
          grade,
          answers: {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        const msg = String(data?.error ?? "");
        // 后端在缺样本时返回 "no used samples for xxx"
        setEstimate(
          /no used samples/i.test(msg)
            ? "该机型暂无二手样本，估价等数据入库后开放"
            : `估价失败：${msg || `服务返回 ${res.status}`}`,
        );
        return;
      }
      const { low, mid, high } = data ?? {};
      setEstimate(
        low != null && high != null
          ? `估价区间 ¥${low}${mid != null ? ` · 中位 ¥${mid}` : ""} ~ ¥${high}`
          : `估价结果：${JSON.stringify(data)}`,
      );
    } catch {
      setEstimate("估价服务暂时不可用，稍后再试");
    } finally {
      setEstimating(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {isMock && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          演示数据：识机 API 未接入，当前为 mock 结果
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-slate-900">
          {activeName || "未知机型"}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {result.category}
        </span>
        {picked && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
            已改选
          </span>
        )}
      </div>

      {/* 置信度进度条 */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>机型识别置信度</span>
          <span
            className={`font-semibold ${picked ? "text-blue-600" : "text-slate-700"}`}
          >
            {picked ? "用户确认" : `${result.confidence}%`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, activeConfidence))}%` }}
          />
        </div>
      </div>

      {/* Top3 候选：AI 第一猜错时，用户在这里点对 */}
      <CandidatePicker
        candidates={candidates}
        pickedName={pickedName}
        onPick={(name) => {
          setPickedName(name);
          setEstimate(null);
        }}
      />

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-[180px_1fr]">
        {/* 成色分环形图 */}
        <div>
          <ReactECharts
            option={gaugeOption}
            style={{ height: 180, width: "100%" }}
            opts={{ renderer: "svg" }}
          />
          <p className="mt-1 text-center text-xs text-slate-400">成色分（0-100）</p>
        </div>

        {/* 瑕疵列表 */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            可见瑕疵（{result.visible_defects.length}）
          </h3>
          {result.visible_defects.length === 0 ? (
            <p className="text-sm text-slate-400">未检测到明显瑕疵</p>
          ) : (
            <ul className="space-y-2">
              {result.visible_defects.map((d, i) => {
                const s = severityStyle(d.severity);
                return (
                  <li
                    key={`${d.area}-${d.type}-${i}`}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                    <span className="text-slate-500">{d.area}</span>
                    <span className="text-slate-800">{d.type}</span>
                    <span
                      className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] ${s.badge}`}
                    >
                      {d.severity}
                    </span>
                    {d.detail && (
                      <span className="text-xs text-slate-400">{d.detail}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {result.notes && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-700">翻新风险提示：</span>
              {result.notes}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {estimate && (
          <span className="text-sm font-medium text-slate-700">{estimate}</span>
        )}
        {catalogId && (
          <Link
            href={`/prices/${encodeURIComponent(catalogId)}?tab=used`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            查看二手行情曲线 →
          </Link>
        )}
        <button
          type="button"
          onClick={handleEstimate}
          disabled={estimating}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {estimating ? "估价中…" : "生成估价"}
        </button>
      </div>
    </div>
  );
}
