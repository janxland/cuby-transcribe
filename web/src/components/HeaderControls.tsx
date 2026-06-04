/**
 * 顶栏右侧"声音 / 加载 MIDI"控件组：
 *  - 按钮：选择本地 .mid/.midi → store.loadMidiFile → Sky15Keys 自动跟随播放
 *  - 弹层：全局默认音色（fallback）+ 合成器主音量
 */
import { useEffect, useRef, useState } from "react";
import { FileMusic, Volume2 } from "lucide-react";
import { useStore } from "@/store";
import { PRESETS, ensureSynthAudio, type PresetId } from "@/components/synth";
import { toneClock } from "@/utils/toneClock";

export function HeaderControls() {
  const { globalPreset, setGlobalPreset, masterVolume, setMasterVolume, loadMidiFile, task } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // 浏览器手势链中解锁 AudioContext + Tone.js（首次必须）
    await ensureSynthAudio();
    await toneClock.ensureStarted();
    await loadMidiFile(f);
    // store.loadMidiFile 内部会调 toneClock.loadScore 并发 autoPlayRequest；
    // 但浏览器对自动播放的策略要求"在用户手势同帧 / 微任务内 start"，
    // 因此这里直接显式 play() 一次更稳。
    await toneClock.play(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const loading = task?.taskId === "local-midi" && task.status === "queued";

  return (
    <div className="ml-auto flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".mid,.midi"
        className="hidden"
        onChange={onPick}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-xs font-medium text-white"
        title="选择本地 .mid/.midi 文件，加载后即可在 25 键上自动演奏"
      >
        <FileMusic className="w-3.5 h-3.5" />
        <span>{loading ? "加载中…" : "加载 MIDI"}</span>
      </button>

      <div className="relative" ref={popRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
          title="键盘默认音色 / 主音量"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>声音</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-4 z-50 text-slate-200 text-xs">
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">
                默认音色
              </label>
              <div className="grid grid-cols-5 gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setGlobalPreset(p.id as PresetId)}
                    className={[
                      "py-1.5 rounded border text-[11px] transition",
                      globalPreset === p.id
                        ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                        : "border-slate-700 bg-slate-800 hover:border-slate-500 text-slate-300",
                    ].join(" ")}
                    title={p.label}
                  >
                    <div className="text-base leading-none">{p.icon}</div>
                    <div className="text-[10px] mt-0.5">{p.label}</div>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">
                未在演奏轨上单独指定时使用
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">主音量</span>
                <span className="font-mono tabular-nums text-slate-300">
                  {Math.round(masterVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={masterVolume}
                onChange={(e) => setMasterVolume(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
