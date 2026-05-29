"""使用 Basic Pitch 把音频转为 MIDI 音符列表。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Tuple
from loguru import logger


def detect_bpm(audio_path: str) -> float:
    """独立的 BPM 探测，供 processor 在分离阶段后台并行调用。"""
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        return float(tempo) if tempo else 120.0
    except Exception as e:
        logger.warning(f"BPM detection failed: {e}")
        return 120.0


def _resolve_model_path() -> str:
    from basic_pitch import build_icassp_2022_model_path, FilenameSuffix
    for suffix in (FilenameSuffix.onnx, FilenameSuffix.coreml, FilenameSuffix.tflite):
        try:
            return build_icassp_2022_model_path(suffix)
        except Exception:
            continue
    from basic_pitch import ICASSP_2022_MODEL_PATH  # type: ignore
    return ICASSP_2022_MODEL_PATH


def transcribe(audio_path: str, bpm: Optional[float] = None) -> Tuple[List[dict], float]:
    """
    返回 (notes, bpm)。
    notes: [{pitch, start, end, velocity}, ...]
    bpm: 可外部传入预算好的值；为 None 时与 basic_pitch 推理 **线程并行** 测算。
    """
    from basic_pitch.inference import predict, Model

    model_path = _resolve_model_path()
    logger.info(f"[transcribe] start: {audio_path} (model={model_path}) bpm_precomputed={bpm is not None}")

    # 没有预算 BPM 时，librosa + basic_pitch 用线程并行，整体时间 = max(两者)
    bpm_future = None
    if bpm is None:
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bpm")
        bpm_future = pool.submit(detect_bpm, audio_path)
        pool.shutdown(wait=False)

    _model_output, _midi_data, note_events = predict(audio_path, Model(model_path))

    notes = []
    for start, end, pitch, velocity, _pitch_bends in note_events:
        if end <= start:
            continue
        notes.append({
            "pitch": int(pitch),
            "start": float(start),
            "end": float(end),
            "velocity": max(1, min(127, int(velocity * 127) if velocity <= 1 else int(velocity))),
        })

    if bpm is None:
        bpm = bpm_future.result() if bpm_future else 120.0

    logger.info(f"[transcribe] done: {len(notes)} notes, bpm={bpm:.1f}")
    notes.sort(key=lambda n: n["start"])
    return notes, bpm
