"""轻量和弦识别 · chroma 模板匹配 + 节拍同步 + Viterbi 平滑。

设计目标：
  - 零新依赖（仅 librosa / numpy）
  - 在节拍/小节级别给出 `[(start, end, root_pc, quality, label)]`
  - 输出供 voicing_reducer 在每个时间步选择保留的根/三/五音

实现要点：
  1. CQT chroma（对纯器乐 / 整曲 / no_vocals 都很稳）；
  2. 在节拍线之间做 chroma 平均 → 与 24 个三和弦模板（12 maj + 12 min）做余弦相似度；
  3. Viterbi 平滑：状态转移惩罚频繁切换（鼓励每小节一个和弦）；
  4. 合并相邻同标签段。

注：相比 BTC / Chordino / All-In-One 等深度模型，这里只是 baseline；后续可平替。
"""
from __future__ import annotations

from typing import List, Optional, Tuple
from loguru import logger


PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# 三和弦模板（12 大三 + 12 小三），共 24 个状态
# pc 偏移：maj = [0,4,7], min = [0,3,7]
def _build_templates():
    import numpy as np
    maj = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    minr = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    tmpls = []
    labels = []
    for r in range(12):
        tmpls.append(np.roll(maj, r))
        labels.append((r, "maj", PITCH_NAMES[r]))
    for r in range(12):
        tmpls.append(np.roll(minr, r))
        labels.append((r, "min", f"{PITCH_NAMES[r]}m"))
    T = np.stack(tmpls, axis=0)
    # 单位化便于做余弦相似度
    T = T / (np.linalg.norm(T, axis=1, keepdims=True) + 1e-9)
    return T, labels


def _viterbi(log_obs, log_switch=-2.5):
    """简单 24 状态 Viterbi：所有切换给同一惩罚，自环 0。"""
    import numpy as np
    T, N = log_obs.shape
    if T == 0:
        return []
    dp = np.full((T, N), -1e18)
    bp = np.zeros((T, N), dtype=np.int32)
    dp[0] = log_obs[0]
    # 转移矩阵：对角 0；非对角 log_switch
    A = np.full((N, N), log_switch)
    np.fill_diagonal(A, 0.0)
    for t in range(1, T):
        # dp[t-1, :, None] + A → 每个目标的最佳前驱
        scores = dp[t - 1][:, None] + A  # (N_prev, N_cur)
        bp[t] = np.argmax(scores, axis=0)
        dp[t] = scores[bp[t], np.arange(N)] + log_obs[t]
    path = np.zeros(T, dtype=np.int32)
    path[-1] = int(np.argmax(dp[-1]))
    for t in range(T - 2, -1, -1):
        path[t] = bp[t + 1, path[t + 1]]
    return path.tolist()


def detect(
    audio_path: str,
    min_segment_sec: float = 0.4,
) -> Tuple[List[dict], List[float]]:
    """
    返回 (chord_segments, beat_times)。
    chord_segments[i] = {"start","end","label","root","quality"}
    """
    import numpy as np
    import librosa

    try:
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
    except Exception as e:
        logger.warning(f"[chord] load failed: {e}")
        return [], []

    if y.size == 0:
        return [], []

    # 1) beats
    tempo = None
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512).tolist()
    except Exception as e:
        logger.warning(f"[chord] beat fallback: {e}")
        beat_times = []

    duration = float(len(y) / sr)
    if not beat_times or beat_times[0] > 0.05:
        beat_times = [0.0] + beat_times
    if beat_times[-1] < duration - 0.05:
        beat_times.append(duration)

    # 2) chroma (CQT 比 STFT 更稳)
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    except Exception as e:
        logger.warning(f"[chord] chroma failed: {e}")
        return [], beat_times

    # 3) beat-synchronous chroma：每两个相邻 beat 之间求平均
    beat_frames_in_chroma = librosa.time_to_frames(beat_times, sr=sr, hop_length=512)
    beat_frames_in_chroma = np.clip(beat_frames_in_chroma, 0, chroma.shape[1])
    n_seg = len(beat_frames_in_chroma) - 1
    if n_seg <= 0:
        return [], beat_times
    seg_chroma = np.zeros((n_seg, 12), dtype=float)
    for i in range(n_seg):
        a, b = beat_frames_in_chroma[i], max(beat_frames_in_chroma[i] + 1, beat_frames_in_chroma[i + 1])
        seg_chroma[i] = chroma[:, a:b].mean(axis=1)
        # 归一化
        nrm = np.linalg.norm(seg_chroma[i])
        if nrm > 1e-9:
            seg_chroma[i] /= nrm

    # 4) 24 模板 cosine similarity → log
    T, labels = _build_templates()
    sim = seg_chroma @ T.T  # (n_seg, 24)
    # log_obs：把 cosine 转成 log-prob 风格（保留相对量级）
    log_obs = np.log(np.clip(sim, 1e-6, None)) * 4.0

    # 5) Viterbi 平滑（鼓励每 1-2 拍一个和弦稳定）
    path = _viterbi(log_obs, log_switch=-2.5)

    # 6) 合并相邻同标签段
    segments: List[dict] = []
    if path:
        cur_state = path[0]
        cur_start_idx = 0
        for i in range(1, n_seg):
            if path[i] != cur_state:
                root, quality, label = labels[cur_state]
                segments.append({
                    "start": float(beat_times[cur_start_idx]),
                    "end": float(beat_times[i]),
                    "root": int(root),
                    "quality": quality,
                    "label": label,
                })
                cur_state = path[i]
                cur_start_idx = i
        # 收尾
        root, quality, label = labels[cur_state]
        segments.append({
            "start": float(beat_times[cur_start_idx]),
            "end": float(beat_times[n_seg]),
            "root": int(root),
            "quality": quality,
            "label": label,
        })

    # 7) 过滤短段（< min_segment_sec），并入相邻
    if segments:
        merged: List[dict] = [segments[0]]
        for seg in segments[1:]:
            last = merged[-1]
            if (seg["end"] - seg["start"]) < min_segment_sec:
                # 短段并到前一段（保持前段标签）
                last["end"] = seg["end"]
                continue
            # 同标签也合并
            if seg["label"] == last["label"]:
                last["end"] = seg["end"]
            else:
                merged.append(seg)
        segments = merged

    logger.info(f"[chord] {len(segments)} segments, beats={len(beat_times)}, tempo≈{tempo}")
    return segments, [float(b) for b in beat_times]


def chord_at(segments: List[dict], t: float) -> Optional[dict]:
    """线性查找 t 时刻所在的和弦段（段数很小）。"""
    if not segments:
        return None
    for seg in segments:
        if seg["start"] <= t < seg["end"]:
            return seg
    return segments[-1] if t >= segments[-1]["end"] else segments[0]


def chord_tones(seg: dict) -> List[int]:
    """返回该和弦的成员音 pitch class（0..11）：root, 3rd, 5th。"""
    if not seg:
        return []
    r = seg["root"]
    third = 3 if seg["quality"] == "min" else 4
    return [r, (r + third) % 12, (r + 7) % 12]


def transpose_chords(segments: List[dict], semitones: int) -> List[dict]:
    """对整个和弦序列做整体移调（与 sky_mapper.transpose 配套）。"""
    if not segments:
        return segments
    out = []
    for seg in segments:
        new_root = (seg["root"] + semitones) % 12
        # 重新组装 label：保留质量后缀
        suffix = "" if seg["quality"] == "maj" else ("m" if seg["quality"] == "min" else seg["quality"])
        out.append({
            **seg,
            "root": new_root,
            "label": f"{PITCH_NAMES[new_root]}{suffix}",
        })
    return out
