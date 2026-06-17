import { AlertCircle, CheckCircle2, Mic2, MonitorSpeaker, Pause, Piano, Play, RotateCcw, Send, Square, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "@/store";
import { useStoreShallow } from "@/selectors";
import { createHummingOptions } from "./hummingOptions";
import { RecorderWaveform } from "./RecorderWaveform";
import { formatBytes, formatDuration } from "./format";
import { useAudioRecorder } from "./useAudioRecorder";
import type { RecorderInput, RecorderTranscribeMode } from "./types";

function isBusy(status?: string) {
  return status === "queued" || status === "processing";
}

export function HumTranscribePanel() {
  const recorder = useAudioRecorder();
  const { setFile, setOptions, startUpload, task } = useStoreShallow((s) => ({
    setFile: s.setFile,
    setOptions: s.setOptions,
    startUpload: s.startUpload,
    task: s.task,
  }));
  const [playableRange, setPlayableRange] = useState(true);
  const [input, setInput] = useState<RecorderInput>("microphone");
  const [mode, setMode] = useState<RecorderTranscribeMode>("humming");
  const busy = isBusy(task?.status);
  const lockInput = recorder.status === "recording" || recorder.status === "paused";
  const canSubmit = recorder.clip && recorder.clip.durationMs >= 900 && !busy;
  const shortClip = recorder.clip && recorder.clip.durationMs < 900;

  const statusText = useMemo(() => {
    if (!recorder.supported) return "浏览器不支持录音";
    if (recorder.status === "recording") return recorder.input === "system" ? "正在采集系统声音" : "正在录音";
    if (recorder.status === "paused") return "已暂停";
    if (recorder.status === "ready") return "可生成曲谱";
    if (recorder.status === "stopping") return "整理音频";
    if (recorder.status === "error") return "录音异常";
    return "准备录音";
  }, [recorder.input, recorder.status, recorder.supported]);

  const submit = async () => {
    if (!recorder.clip || !canSubmit) return;
    setFile(recorder.clip.file);
    setOptions(createHummingOptions(playableRange, mode));
    await startUpload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-100">哼唱成谱</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {mode === "instrument"
              ? "录钢琴或器乐片段，按保真方式生成谱面"
              : input === "system"
                ? "采集系统内声音，直接生成可编辑曲谱"
                : "录一段旋律，直接生成可编辑曲谱"}
          </div>
        </div>
        <div
          className={[
            "px-2 py-1 rounded-full border text-[10px]",
            recorder.status === "recording"
              ? "border-rose-400/50 bg-rose-500/10 text-rose-200"
              : recorder.status === "ready"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                : "border-slate-700 bg-slate-900 text-slate-400",
          ].join(" ")}
        >
          {statusText}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("humming")}
          disabled={lockInput}
          className={[
            "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
            mode === "humming"
              ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
            lockInput ? "opacity-70" : "",
          ].join(" ")}
        >
          <Waves className="w-3.5 h-3.5" />
          哼唱 / 单旋律
        </button>
        <button
          type="button"
          onClick={() => setMode("instrument")}
          disabled={lockInput}
          className={[
            "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
            mode === "instrument"
              ? "border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-100"
              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
            lockInput ? "opacity-70" : "",
          ].join(" ")}
        >
          <Piano className="w-3.5 h-3.5" />
          钢琴 / 器乐
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setInput("microphone")}
          disabled={lockInput}
          className={[
            "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
            input === "microphone"
              ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
            lockInput ? "opacity-70" : "",
          ].join(" ")}
        >
          <Mic2 className="w-3.5 h-3.5" />
          麦克风
        </button>
        <button
          type="button"
          onClick={() => setInput("system")}
          disabled={!recorder.supportsSystemAudio || lockInput}
          className={[
            "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
            input === "system"
              ? "border-sky-400/60 bg-sky-500/10 text-sky-100"
              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
            (!recorder.supportsSystemAudio || lockInput) ? "opacity-70" : "",
          ].join(" ")}
          title={recorder.supportsSystemAudio ? "采集浏览器或系统共享出来的音频" : "当前浏览器不支持系统声音采集"}
        >
          <MonitorSpeaker className="w-3.5 h-3.5" />
          系统内声音
        </button>
      </div>

      {input === "system" && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-100/90">
          开始后会弹出共享窗口。最稳的是直接选浏览器标签页并勾选“共享音频 / Share audio”；部分桌面窗口或应用本身不提供系统音轨。
        </div>
      )}

      {mode === "instrument" && (
        <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2 text-[11px] text-fuchsia-100/90">
          钢琴 / 器乐会走保真器乐转录，不再按人声单旋律处理。单音钢琴、右手旋律、分解和弦都会比“哼唱模式”准得多。
        </div>
      )}

      <RecorderWaveform waveform={recorder.waveform} level={recorder.level} status={recorder.status} />

      <div className="flex items-center gap-2">
        <div className="font-mono text-2xl tabular-nums text-slate-100 min-w-20">
          {formatDuration(recorder.elapsedMs)}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {(recorder.status === "idle" || recorder.status === "ready" || recorder.status === "error") && (
            <button
              type="button"
              onClick={() => void recorder.start(input)}
              disabled={!recorder.supported || busy}
              className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 flex items-center justify-center transition"
              title={input === "system" ? "开始采集系统内声音" : "开始录音"}
            >
              {input === "system" ? <MonitorSpeaker className="w-4 h-4" /> : <Mic2 className="w-4 h-4" />}
            </button>
          )}
          {recorder.status === "recording" && (
            <>
              <button
                type="button"
                onClick={recorder.pause}
                className="w-9 h-9 rounded-full border border-slate-700 hover:border-slate-500 flex items-center justify-center transition"
                title="暂停"
              >
                <Pause className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={recorder.stop}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-950 hover:bg-white flex items-center justify-center transition"
                title="停止"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            </>
          )}
          {recorder.status === "paused" && (
            <>
              <button
                type="button"
                onClick={recorder.resume}
                className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition"
                title="继续录音"
              >
                <Play className="w-4 h-4 ml-0.5" />
              </button>
              <button
                type="button"
                onClick={recorder.stop}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-950 hover:bg-white flex items-center justify-center transition"
                title="停止"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            </>
          )}
          {recorder.clip && (
            <button
              type="button"
              onClick={recorder.reset}
              disabled={busy}
              className="w-9 h-9 rounded-full border border-slate-700 hover:border-slate-500 disabled:opacity-50 flex items-center justify-center transition"
              title="重新录制"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {recorder.error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{recorder.error}</span>
        </div>
      )}

      {recorder.clip && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="truncate">{recorder.clip.file.name}</span>
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
              {recorder.clip.source === "system" ? "系统声" : "麦克风"}
            </span>
            <span className="ml-auto shrink-0 text-slate-500">{formatBytes(recorder.clip.blob.size)}</span>
          </div>
          <audio src={recorder.clip.url} controls className="w-full h-8" />
          {shortClip && (
            <div className="text-[11px] text-amber-300">录音太短，建议至少哼唱 1 秒以上。</div>
          )}
        </div>
      )}

      {mode === "humming" && (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
          <span className="text-slate-300">推荐到可弹奏调</span>
          <input
            type="checkbox"
            checked={playableRange}
            onChange={(e) => setPlayableRange(e.target.checked)}
            className="accent-emerald-400"
          />
        </label>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void submit()}
        className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 font-medium transition flex items-center justify-center gap-2"
      >
        <Send className="w-4 h-4" />
        {busy ? "任务处理中…" : "生成曲谱"}
      </button>
    </div>
  );
}
