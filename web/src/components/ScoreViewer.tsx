import { useState } from "react";
import { useStore } from "../store";
import { PianoRoll } from "./PianoRoll";
import { Sky15Keys } from "./Sky15Keys";
import { StemsPanel } from "./StemsPanel";
import { ErrorBoundary } from "./ErrorBoundary";

type Tab = "stems" | "sky" | "roll" | "json";

export function ScoreViewer() {
  const { score, stems } = useStore();
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
    ["roll", "钢琴卷帘"],
    ["json", "JSON"],
  ];

  return (
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

      {/* 内容区：撑满剩余空间 + 自身滚动 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "stems" && <ErrorBoundary name="StemsPanel"><StemsPanel /></ErrorBoundary>}
        {tab === "sky" && (score ? <div className="p-3"><ErrorBoundary name="Sky15Keys"><Sky15Keys /></ErrorBoundary></div> : <Empty />)}
        {tab === "roll" && (score ? <div className="p-3"><ErrorBoundary name="PianoRoll"><PianoRoll /></ErrorBoundary></div> : <Empty />)}
        {tab === "json" && score && (
          <pre className="m-3 rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
            {JSON.stringify(score, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center text-slate-500 text-sm">
      还没有 CubyScore
    </div>
  );
}
