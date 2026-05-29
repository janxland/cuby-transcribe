import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useStore } from "../store";

export function ProgressCard() {
  const { task, meta } = useStore();
  if (!task) return null;

  const Icon =
    task.status === "completed" ? CheckCircle2 :
    task.status === "failed" ? XCircle : Loader2;
  const color =
    task.status === "completed" ? "text-emerald-400" :
    task.status === "failed" ? "text-rose-400" : "text-indigo-400";
  const spin = task.status !== "completed" && task.status !== "failed";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${color} ${spin ? "animate-spin" : ""}`} />
        <span className="font-medium capitalize">{task.status}</span>
        <span className="text-slate-400 text-sm">{task.message}</span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
          style={{ width: `${task.progress}%` }}
        />
      </div>
      {task.error && (
        <div className="text-rose-400 text-xs font-mono break-all">{task.error}</div>
      )}
      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 text-xs">
          <Stat label="调性" value={`${meta.detectedKey} ${meta.detectedMode}`} />
          <Stat label="BPM" value={meta.bpm.toFixed(1)} />
          <Stat label="时长" value={`${meta.duration.toFixed(1)}s`} />
          <Stat label="音符" value={meta.noteCount} />
          <Stat label="耗时" value={`${meta.elapsed.toFixed(1)}s`} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-slate-800/60 px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-100 font-mono">{value}</div>
    </div>
  );
}
