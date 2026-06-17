import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordedClip, RecorderInput, RecorderSnapshot, RecorderStatus } from "./types";

const WAVEFORM_BARS = 36;

interface RecorderFormat {
  mimeType: string;
  extension: string;
}

function pickRecorderFormat(): RecorderFormat {
  const candidates: RecorderFormat[] = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  const mediaRecorder = window.MediaRecorder;
  return candidates.find((c) => mediaRecorder.isTypeSupported(c.mimeType)) ?? { mimeType: "", extension: "webm" };
}

function clipName(extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `humming-${stamp}.${extension}`;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function createRecorderStream(source: MediaStream, input: RecorderInput): MediaStream {
  if (input !== "system") return source;
  return new MediaStream(source.getAudioTracks());
}

export function useAudioRecorder() {
  const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && Boolean(mediaDevices?.getUserMedia);
  const supportsSystemAudio = typeof window !== "undefined" && Boolean(mediaDevices?.getDisplayMedia);
  const [snapshot, setSnapshot] = useState<RecorderSnapshot>({
    status: "idle",
    input: "microphone",
    elapsedMs: 0,
    level: 0,
    waveform: Array.from({ length: WAVEFORM_BARS }, () => 0.04),
    clip: null,
    error: null,
    supported,
    supportsSystemAudio,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const recordedBeforePauseRef = useRef<number>(0);
  const formatRef = useRef<RecorderFormat>({ mimeType: "", extension: "webm" });
  const clipUrlRef = useRef<string | null>(null);
  const discardStopRef = useRef(false);

  const setStatus = useCallback((status: RecorderStatus, patch: Partial<RecorderSnapshot> = {}) => {
    setSnapshot((prev) => ({ ...prev, status, ...patch }));
  }, []);

  const revokeClipUrl = useCallback(() => {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const closeAudioContext = useCallback(() => {
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, []);

  const releaseInput = useCallback(() => {
    stopMeter();
    closeAudioContext();
    stopStream(streamRef.current);
    streamRef.current = null;
    stopStream(sourceStreamRef.current);
    sourceStreamRef.current = null;
  }, [closeAudioContext, stopMeter]);

  const tickMeter = useCallback(() => {
    const analyser = analyserRef.current;
    const recorder = recorderRef.current;
    if (!analyser || !recorder || recorder.state === "inactive") return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    const level = Math.min(1, rms * 5);
    const elapsedMs = recorder.state === "recording"
      ? recordedBeforePauseRef.current + performance.now() - startedAtRef.current
      : recordedBeforePauseRef.current;

    setSnapshot((prev) => ({
      ...prev,
      elapsedMs,
      level,
      waveform: [...prev.waveform.slice(1), Math.max(0.04, level)],
    }));

    rafRef.current = requestAnimationFrame(tickMeter);
  }, []);

  const start = useCallback(async (input: RecorderInput = "microphone") => {
    if (!supported) {
      setStatus("error", { error: "当前浏览器不支持录音，请换用最新版 Chrome / Edge / Safari。" });
      return;
    }
    if (input === "system" && !supportsSystemAudio) {
      setStatus("error", { error: "当前浏览器不支持系统内声音采集，请换用最新版 Chrome 或 Edge。" });
      return;
    }

    releaseInput();
    revokeClipUrl();
    chunksRef.current = [];
    recordedBeforePauseRef.current = 0;
    setStatus("idle", {
      elapsedMs: 0,
      level: 0,
      clip: null,
      error: null,
      waveform: Array.from({ length: WAVEFORM_BARS }, () => 0.04),
    });

    try {
      setStatus("idle", { error: null });
      const stream = input === "system"
        ? await mediaDevices!.getDisplayMedia({
            video: true,
            audio: true,
          })
        : await mediaDevices!.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

      if (stream.getAudioTracks().length === 0) {
        stopStream(stream);
        throw new Error(
          input === "system"
            ? "没有捕获到系统内声音。共享屏幕时请勾选“共享音频”或“Share audio”。"
            : "没有检测到可用麦克风。",
        );
      }
      const recorderStream = createRecorderStream(stream, input);
      if (recorderStream.getAudioTracks().length === 0) {
        stopStream(stream);
        throw new Error("当前共享源没有可录制的音频轨。请改选带音频的标签页或窗口。");
      }
      sourceStreamRef.current = stream;
      streamRef.current = recorderStream;
      formatRef.current = pickRecorderFormat();

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(recorderStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(
        recorderStream,
        formatRef.current.mimeType ? { mimeType: formatRef.current.mimeType } : undefined,
      );
      discardStopRef.current = false;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        const reason = event.error?.message?.trim();
        setStatus("error", {
          error: reason || (input === "system"
            ? "系统声音采集中断，请重新选择共享音频源。"
            : "录音中断，请检查麦克风权限后重试。"),
        });
        releaseInput();
      };
      recorder.onstop = () => {
        if (discardStopRef.current) {
          discardStopRef.current = false;
          recorderRef.current = null;
          releaseInput();
          return;
        }
        const mimeType = formatRef.current.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const file = new File([blob], clipName(formatRef.current.extension), { type: mimeType });
        clipUrlRef.current = url;
        const durationMs = Math.max(0, recordedBeforePauseRef.current);
        const clip: RecordedClip = { blob, file, url, durationMs, mimeType, source: input };
        recorderRef.current = null;
        releaseInput();
        setStatus("ready", { clip, level: 0, elapsedMs: durationMs, input });
      };

      startedAtRef.current = performance.now();
      recorder.start(500);
      setStatus("recording", { error: null, input });
      rafRef.current = requestAnimationFrame(tickMeter);
    } catch (error) {
      releaseInput();
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? input === "system"
          ? "系统内声音权限被拒绝，请在共享窗口时允许浏览器捕获音频。"
          : "麦克风权限被拒绝，请允许浏览器访问麦克风。"
        : error instanceof Error
          ? error.message
          : "无法启动录音。";
      setStatus("error", { error: message, input });
    }
  }, [mediaDevices, releaseInput, revokeClipUrl, setStatus, supported, supportsSystemAudio, tickMeter]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recordedBeforePauseRef.current += performance.now() - startedAtRef.current;
    recorder.pause();
    setStatus("paused", { elapsedMs: recordedBeforePauseRef.current });
  }, [setStatus]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    startedAtRef.current = performance.now();
    recorder.resume();
    setStatus("recording");
  }, [setStatus]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") {
      recordedBeforePauseRef.current += performance.now() - startedAtRef.current;
    }
    setStatus("stopping");
    recorder.stop();
  }, [setStatus]);

  const reset = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      discardStopRef.current = true;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    recordedBeforePauseRef.current = 0;
    releaseInput();
    revokeClipUrl();
    setSnapshot((prev) => ({
      ...prev,
      status: "idle",
      elapsedMs: 0,
      level: 0,
      clip: null,
      error: null,
      waveform: Array.from({ length: WAVEFORM_BARS }, () => 0.04),
    }));
  }, [releaseInput, revokeClipUrl]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        discardStopRef.current = true;
        recorder.stop();
      }
      releaseInput();
      revokeClipUrl();
    };
  }, [releaseInput, revokeClipUrl]);

  return {
    ...snapshot,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
