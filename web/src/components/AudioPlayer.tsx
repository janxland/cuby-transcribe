import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";
import { useStore } from "@/store";
import { useStoreShallow, usePrimaryScore } from "@/selectors";

/**
 * 顶部"原音预听"条：仅播放用户上传的原始文件，跟 Mixer 引擎相互独立。
 * 同时把 currentTime 同步到 store 供 PianoRoll / Sky15 显示播放头。
 */
export function AudioPlayer() {
  const { audioUrl, file } = useStoreShallow((s) => ({ audioUrl: s.audioUrl, file: s.file }));
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const score = usePrimaryScore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const tick = () => { setCurrentTime(a.currentTime); raf = requestAnimationFrame(tick); };
    const onPlay  = () => { setPlaying(true);  raf = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      cancelAnimationFrame(raf);
    };
  }, [audioUrl, setCurrentTime]);

  if (!audioUrl) return null;

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };

  const downloadScore = () => {
    if (!score) return;
    const name = (score.meta?.title || file?.name || "score") + ".cuby.json";
    const blob = new Blob([JSON.stringify(score, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="px-3 py-2 flex items-center gap-3">
      <button
        onClick={toggle}
        className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center shrink-0"
        title="原音预听"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">原音预听</div>
      <audio ref={audioRef} src={audioUrl} controls className="flex-1 h-8" />
      {score && (
        <button
          onClick={downloadScore}
          className="px-2.5 py-1.5 text-xs rounded-md bg-slate-800 hover:bg-slate-700 flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" /> JSON
        </button>
      )}
    </div>
  );
}
