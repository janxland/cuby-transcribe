"""单音旋律提取（PYIN）。

为什么需要：Basic Pitch 是 **复音** 模型，即便对分离出的 vocals.wav 也会
因泛音 / 呼气 / 残留伴奏 / 合声而输出大量碎音和重叠，导致 15 键扒谱"乱糟糟"。
针对 Sky 一指弹这种 **天然单旋律** 需求，PYIN（probabilistic YIN）直接拿到
帧级 F0 + 浊音概率，然后做"按音高稳定段聚合 → 中位数取整 → 时长/置信度过滤"。
输出保证单调（无重叠），更接近口袋音乐"扒主旋律"的体验。

依赖：仅 librosa（已在 requirements.txt）。
"""
from __future__ import annotations

from typing import List, Optional, Tuple
from loguru import logger


# 调参的默认值 —— 对人声旋律优化
DEFAULT_FMIN_HZ = 65.0     # ~ C2，覆盖男低音
DEFAULT_FMAX_HZ = 1200.0   # ~ D6，覆盖女高
DEFAULT_FRAME_LENGTH = 2048
DEFAULT_HOP_LENGTH = 256   # 在 22050Hz 下 ≈ 11.6ms / 帧
DEFAULT_VOICED_PROB = 0.55 # 浊音概率门槛
DEFAULT_MIN_NOTE_SEC = 0.10
DEFAULT_MAX_PITCH_GAP = 0.5  # 同一音符内允许的最大半音漂移（中位数稳定段判定）


def _pyin_curve(audio_path: str) -> Tuple["np.ndarray", "np.ndarray", float]:
    """返回 (f0_hz, voiced_prob, frame_dt)。无声/未检测为 NaN。"""
    import numpy as np
    import librosa

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=DEFAULT_FMIN_HZ,
        fmax=DEFAULT_FMAX_HZ,
        sr=sr,
        frame_length=DEFAULT_FRAME_LENGTH,
        hop_length=DEFAULT_HOP_LENGTH,
        fill_na=np.nan,
    )
    frame_dt = DEFAULT_HOP_LENGTH / sr
    # 浊音概率：把 NaN 视作 0
    voiced_prob = np.nan_to_num(voiced_prob, nan=0.0)
    return f0, voiced_prob, frame_dt


def _f0_to_midi(f0_hz: float) -> float:
    import math
    if f0_hz <= 0 or f0_hz != f0_hz:  # NaN
        return float("nan")
    return 69.0 + 12.0 * math.log2(f0_hz / 440.0)


def _segment(
    f0_hz,
    voiced_prob,
    frame_dt: float,
    voiced_thresh: float,
    min_note_sec: float,
    max_pitch_gap: float,
) -> List[dict]:
    """把帧级 F0 聚合成音符列表 [{pitch, start, end, velocity}]。"""
    import numpy as np

    n = len(f0_hz)
    if n == 0:
        return []

    midi = np.array([_f0_to_midi(float(f)) for f in f0_hz], dtype=float)
    rounded = np.round(midi)

    notes: List[dict] = []
    i = 0
    while i < n:
        # 跳过非浊音 / NaN
        if not (voiced_prob[i] >= voiced_thresh and midi[i] == midi[i]):
            i += 1
            continue
        # 起一个新段：在同 round 半音内、且 voiced 充分时连续扩张
        start = i
        cur_round = rounded[i]
        running = [midi[i]]
        j = i + 1
        while j < n and voiced_prob[j] >= voiced_thresh and midi[j] == midi[j]:
            # 半音漂移过大就断开（颤音/滑音处）
            if abs(midi[j] - np.median(running)) > max_pitch_gap:
                break
            # round 改变 → 新音
            if rounded[j] != cur_round:
                break
            running.append(midi[j])
            j += 1
        end = j

        dur = (end - start) * frame_dt
        if dur >= min_note_sec:
            pitch = int(np.median(running).round())
            # velocity 取段内能量代理：我们没有能量，用浊音概率均值映射到 60..110
            vp = float(np.mean(voiced_prob[start:end]))
            vel = max(60, min(110, int(60 + vp * 50)))
            notes.append({
                "pitch": pitch,
                "start": start * frame_dt,
                "end": end * frame_dt,
                "velocity": vel,
            })
        i = end if end > i else i + 1

    # 合并相邻同音的细微间隙（< 80ms）
    if notes:
        merged = [dict(notes[0])]
        for nt in notes[1:]:
            last = merged[-1]
            if nt["pitch"] == last["pitch"] and (nt["start"] - last["end"]) < 0.08:
                last["end"] = nt["end"]
                last["velocity"] = max(last["velocity"], nt["velocity"])
            else:
                merged.append(dict(nt))
        notes = merged

    return notes


def detect_bpm_with_pyin_byproduct(audio_path: str) -> float:
    """复用一次加载估 BPM。"""
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        return float(tempo) if tempo else 120.0
    except Exception as e:
        logger.warning(f"[melody] bpm fallback: {e}")
        return 120.0


def extract(
    audio_path: str,
    bpm: Optional[float] = None,
    voiced_thresh: float = DEFAULT_VOICED_PROB,
    min_note_sec: float = DEFAULT_MIN_NOTE_SEC,
) -> Tuple[List[dict], float]:
    """
    对单声部（最适合人声 vocals.wav）做 PYIN 单旋律提取。
    返回 (notes, bpm)。
    """
    logger.info(f"[melody-pyin] start: {audio_path}")
    f0, vp, dt = _pyin_curve(audio_path)
    notes = _segment(f0, vp, dt, voiced_thresh, min_note_sec, DEFAULT_MAX_PITCH_GAP)
    if bpm is None:
        bpm = detect_bpm_with_pyin_byproduct(audio_path)
    logger.info(f"[melody-pyin] done: {len(notes)} notes, bpm={bpm:.1f}")
    notes.sort(key=lambda n: n["start"])
    return notes, float(bpm)
