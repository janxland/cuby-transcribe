import { useState } from "react";
import { useStore } from "../store";
import { PianoRoll } from "./PianoRoll";
import { Sky15Keys } from "./Sky15Keys";

type Tab = "sky" | "roll" | "json";

export function ScoreViewer() {
  const { score } = useStore();
  const [tab, setTab] = useState<Tab>("sky");

  if (!score) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-800">
        {(
          [
            ["sky", "光遇 15 键"],
            ["roll", "钢琴卷帘"],
            ["json", "CubyScore JSON"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={[
              "px-4 py-2 text-sm border-b-2 transition -mb-px",
              tab === k
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === "sky" && <Sky15Keys />}
        {tab === "roll" && <PianoRoll />}
        {tab === "json" && (
          <pre className="rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs max-h-[60vh] overflow-auto font-mono text-slate-300">
            {JSON.stringify(score, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
