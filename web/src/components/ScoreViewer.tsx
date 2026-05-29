import { useState } from "react";
import { useStore } from "../store";
import { PianoRoll } from "./PianoRoll";
import { Sky15Keys } from "./Sky15Keys";
import { StemsPanel } from "./StemsPanel";

type Tab = "sky" | "roll" | "stems" | "json";

export function ScoreViewer() {
  const { score, stems } = useStore();
  const [tab, setTab] = useState<Tab>("sky");

  if (!score && !stems.length) return null;

  const tabs: [Tab, string, number?][] = [
    ["sky", "光遇 15 键"],
    ["roll", "钢琴卷帘"],
    ["stems", "音轨", stems.length],
    ["json", "JSON"],
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
        {tabs.map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={[
              "px-4 py-2 text-sm border-b-2 transition -mb-px whitespace-nowrap flex items-center gap-1.5",
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

      <div>
        {tab === "sky" && (score ? <Sky15Keys /> : <Empty />)}
        {tab === "roll" && (score ? <PianoRoll /> : <Empty />)}
        {tab === "stems" && <StemsPanel />}
        {tab === "json" && score && (
          <pre className="rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs max-h-[60vh] overflow-auto font-mono text-slate-300">
            {JSON.stringify(score, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
      还没有 CubyScore
    </div>
  );
}
