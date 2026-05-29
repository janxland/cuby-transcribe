import { useState } from "react";
import { useStore } from "../store";
import { stemMeta } from "../stems";
import { PianoRoll } from "./PianoRoll";
import { Sky15Keys } from "./Sky15Keys";
import { StemsPanel } from "./StemsPanel";
import { ScoreEditor } from "./editor";
import { ErrorBoundary } from "./ErrorBoundary";
import { MixerProvider } from "./mixer";

type Tab = "stems" | "sky" | "edit" | "roll" | "json";

export function ScoreViewer() {
  const { score, stems, scores, activeStems, toggleActiveStem } = useStore();
  const [tab, setTab] = useState<Tab>("stems");

  if (!score && !stems.length) {
    return (
      <div className="h-full rounded-xl border border-dashed border-slate-800 flex items-center justify-center text-slate-500 text-sm">
        在左侧上传音频后开始工作
      </div>
    );
  }

  const tabs: [Tab, string, number?][] = [
    ["stems", "音轨混音", stems.length],
    ["sky", "光遇 15 键"],
    ["edit", "谱子编辑"],
    ["roll", "钢琴卷帘"],
    ["json", "JSON"],
  ];

  const scoreList = Object.entries(scores).map(([stem, e]) => ({
    stem,
    noteCount: e.score.tracks?.[0]?.notes?.length ?? 0,
  }));

  // 把 MixerProvider 提到 Tabs 之上：切到 Sky / Roll 时混音引擎不丢失，
  // Sky15Keys 可以共用同一个时间轴 + 音轨状态。
  return (
    <MixerProvider tracks={stems}>
      <div className="h-full flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
      {/* 标签栏 */}
      <div className="shrink-0 flex gap-0 border-b border-slate-800 bg-slate-900/40 px-2 overflow-x-auto">
        {tabs.map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={[
              "px-4 py-2.5 text-sm border-b-2 transition -mb-px whitespace-nowrap flex items-center gap-1.5",
              tab === k
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200",
            ].join(" ")}
          >
            {label}
            {count !== undefined && count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* 谱子多选器：点击加入演奏列表，再点击移出；首位为主显（PianoRoll / JSON 展示其内容） */}
      {scoreList.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-slate-800 bg-slate-950/60 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">演奏谱子</span>
          {scoreList.map(({ stem, noteCount }) => {
            const m = stemMeta(stem);
            const idx = activeStems.indexOf(stem);
            const on = idx >= 0;
            const primary = idx === 0;
            return (
              <button
                key={stem}
                onClick={() => toggleActiveStem(stem)}
                className={[
                  "px-2.5 py-1 text-xs rounded-md border flex items-center gap-1.5 transition",
                  primary
                    ? "bg-amber-400/20 border-amber-400 text-amber-100"
                    : on
                      ? "bg-emerald-500/15 border-emerald-400 text-emerald-100"
                      : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-700/60",
                ].join(" ")}
                title={on ? `点击从演奏列表移出 ${m.label}` : `点击加入演奏列表（${noteCount} 个音符）`}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
                <span className="text-[10px] opacity-60">×{noteCount}</span>
                {primary && <span className="text-[9px] px-1 rounded bg-amber-300 text-slate-900 font-bold leading-none">主</span>}
              </button>
            );
          })}
          {activeStems.length > 0 && (
            <span className="ml-auto text-[10px] text-slate-500">同时演奏 {activeStems.length} 轨</span>
          )}
        </div>
      )}

      {/* 内容区：撑满剩余空间 + 自身滚动 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "stems" && <ErrorBoundary name="StemsPanel"><StemsPanel /></ErrorBoundary>}
        {tab === "sky" && (score ? <div className="p-3"><ErrorBoundary name="Sky15Keys"><Sky15Keys /></ErrorBoundary></div> : <Empty />)}
        {tab === "edit" && (score ? <ErrorBoundary name="ScoreEditor"><ScoreEditor /></ErrorBoundary> : <Empty />)}
        {tab === "roll" && (score ? <div className="p-3"><ErrorBoundary name="PianoRoll"><PianoRoll /></ErrorBoundary></div> : <Empty />)}
        {tab === "json" && score && (
          <pre className="m-3 rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
            {JSON.stringify(score, null, 2)}
          </pre>
        )}
      </div>
    </div>
    </MixerProvider>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center text-slate-500 text-sm">
      还没有 CubyScore
    </div>
  );
}
