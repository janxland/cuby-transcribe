import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download, RotateCw } from "lucide-react";
import { useStore } from "../store";
import { stemMeta } from "../stems";

export function StemsPanel() {
  const { stems, meta, retranscribeWith, task } = useStore();
  if (!stems.length) return null;

  const transcribed = meta?.transcribedStem;
  const busy = task && task.status !== "completed" && task.status !== "failed";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-300">分离后的音轨</h3>
        <span className="text-[11px] text-slate-500">点击播放预览 · 切换扒谱对象</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {stems.map((s) => (
          <StemRow
            key={s.name}
            stem={s}
            active={transcribed === s.name}
            onRetranscribe={() => !busy && retranscribeWith(s.name)}
            disabled={!!busy}
          />
        ))}
      </div>
    </div>
  );
}

function StemRow({
  stem, active, onRetranscribe, disabled,
}: {
  stem: { name: string; url: string; duration: number };
  active: boolean;
  onRetranscribe: () => void;
  disabled: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const meta = stemMeta(stem.name);

  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    a.addEventListener("play", on); a.addEventListener("pause", off); a.addEventListener("ended", off);
    return () => { a.removeEventListener("play", on); a.removeEventListener("pause", off); a.removeEventListener("ended", off); };
  }, []);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) {
      // 暂停其它所有 audio
      document.querySelectorAll("audio").forEach((el) => { if (el !== a) (el as HTMLAudioElement).pause(); });
      a.play();
    } else a.pause();
  };

  return (
    <div className={[
      "rounded-lg border p-3 flex items-center gap-3 transition",
      active ? "border-amber-400 bg-amber-400/5" : "border-slate-800 hover:border-slate-700",
    ].join(" ")}>
      <button
        onClick={toggle}
        className={`w-10 h-10 shrink-0 rounded-full bg-gradient-to-br ${meta.color} flex items-center justify-center text-white`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          {active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-slate-900 font-bold">扒谱中</span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">{stem.duration.toFixed(1)}s</div>
      </div>
      <audio ref={audioRef} src={stem.url} preload="none" />
      <a
        href={stem.url}
        download={`${stem.name}.wav`}
        className="p-1.5 hover:bg-slate-800 rounded"
        title="下载"
      >
        <Download className="w-4 h-4 text-slate-400" />
      </a>
      {!active && (
        <button
          disabled={disabled}
          onClick={onRetranscribe}
          title="用这条音轨重新扒谱"
          className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1"
        >
          <RotateCw className="w-3 h-3" /> 扒
        </button>
      )}
    </div>
  );
}
