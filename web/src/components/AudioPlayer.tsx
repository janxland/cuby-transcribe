import { useEffect, useRef } from "react";
import { Play, Pause, Download } from "lucide-react";
import { useStore } from "../store";

export function AudioPlayer() {
  const { audioUrl, isPlaying, setPlayback, score, file } = useStore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const tick = () => {
      setPlayback({ currentTime: a.currentTime });
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlayback({ isPlaying: true });
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlayback({ isPlaying: false });
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioUrl, setPlayback]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };

  const download = () => {
    if (!score) return;
    const name = (score.meta?.title || file?.name || "score") + ".cuby.json";
    const blob = new Blob([JSON.stringify(score, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!audioUrl) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex items-center gap-3">
      <button
        onClick={toggle}
        className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center"
      >
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </button>
      <audio ref={audioRef} src={audioUrl} controls className="flex-1" />
      {score && (
        <button
          onClick={download}
          className="px-3 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" /> JSON
        </button>
      )}
    </div>
  );
}
