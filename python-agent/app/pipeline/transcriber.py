"""使用 Basic Pitch 把音频转为 MIDI 音符列表 · v2 · 增强幽灵音符过滤。

改进点：
  1. 基础过滤：极短+极弱毛刺
  2. 音域过滤：去掉与中位音高偏差 >18 半音的离群
  3. 密度过滤：每 100ms 窗口内最多保留 max_density 个音（按 velocity 排序）
     → 有效去掉 Basic Pitch 在鼓点/噪声处的爆发性碎片
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Tuple
from loguru import logger
import numpy as np

MIN_NOTE_SEC = 0.05
MIN_VELOCITY = 18
MAX_DENSITY = 8  # 每 100ms 窗口最大音符数


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


def _filter_ghost_notes(
    notes: List[dict],
    min_dur: float = MIN_NOTE_SEC,
    min_vel: int = MIN_VELOCITY,
    max_density: int = MAX_DENSITY,
) -> List[dict]:
    """
    过滤幽灵音符：
    1. 极短 + 极弱的毛刺
    2. 与主体音域偏差过大的离群音
    3. 同一时间窗口内音符密度过高的（真实音乐很少同时 >8 音）
    """
    if not notes:
        return notes

    # 基础过滤：极短且极弱
    filtered = []
    for n in notes:
        dur = n["end"] - n["start"]
        vel = n["velocity"]
        # 极短+弱 → 丢弃；但如果 velocity 很高则保留（可能是打击性音符）
        if dur < min_dur and vel < min_vel * 2:
            continue
        if vel < min_vel:
            continue
        filtered.append(n)

    # 音域过滤：v3 改用百分位数边界。
    # 旧版 median±18 对吉他/钢琴这种跨 5+ 八度的曲目会砍掉所有 bass —— 与 爱扒谱 对比
    # 时音域只剩 C4-C6 就是这里的锅。改成 P2..P98 再扩 6 半音，保留主体音域同时去掉孤立离群。
    if len(filtered) >= 8:
        pitches = np.array([n["pitch"] for n in filtered])
        lo = float(np.percentile(pitches, 2)) - 6.0
        hi = float(np.percentile(pitches, 98)) + 6.0
        filtered = [n for n in filtered if lo <= n["pitch"] <= hi]

    # 密度过滤：每 100ms 窗口内最多保留 max_density 个音（按 velocity 降序留强的）
    if filtered:
        filtered.sort(key=lambda n: n["start"])
        window = 0.1
        out = []
        i = 0
        while i < len(filtered):
            t0 = filtered[i]["start"]
            window_notes = []
            j = i
            while j < len(filtered) and filtered[j]["start"] < t0 + window:
                window_notes.append(filtered[j])
                j += 1
            # 按 velocity 降序，保留前 max_density 个
            window_notes.sort(key=lambda n: -n["velocity"])
            out.extend(window_notes[:max_density])
            i = j if j > i else i + 1
        filtered = sorted(out, key=lambda n: n["start"])

    return filtered


def transcribe(audio_path: str, bpm: Optional[float] = None) -> Tuple[List[dict], float]:
    """
    返回 (notes, bpm)。
    notes: [{pitch, start, end, velocity}, ...]
    bpm: 可外部传入预算好的值；为 None 时与 basic_pitch 推理线程并行测算。
    """
    from basic_pitch.inference import predict, Model

    model_path = _resolve_model_path()
    logger.info(f"[transcribe] start: {audio_path} (model={model_path}) bpm_precomputed={bpm is not None}")

    # 没有预算 BPM 时，librosa + basic_pitch 用线程并行
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
        vel = max(1, min(127, int(velocity * 127) if velocity <= 1 else int(velocity)))
        notes.append({
            "pitch": int(pitch),
            "start": float(start),
            "end": float(end),
            "velocity": vel,
        })

    # v2: 增强幽灵音符过滤
    before_count = len(notes)
    notes = _filter_ghost_notes(notes)

    if bpm is None:
        bpm = bpm_future.result() if bpm_future else 120.0

    logger.info(f"[transcribe] done: {len(notes)} notes (filtered {before_count - len(notes)} ghosts), bpm={bpm:.1f}")
    notes.sort(key=lambda n: n["start"])
    return notes, bpm
