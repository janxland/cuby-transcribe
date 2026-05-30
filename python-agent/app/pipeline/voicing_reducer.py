"""15 键 voicing reducer · v3 · 旋律优先 + 和弦持续。

设计目标：
  1. **旋律必须能听出**：把权威旋律线（PYIN 人声 / 或 top-of-poly 的 melody_notes）
     原样保留成长音（不再按 sub-beat 切碎），velocity 拉到最高 (~115)。
  2. **和弦像钢琴左手**：每个 chord_segment 发一次根音，按整段持续；可选 5th。
     不再每帧重写 → 听感自然连贯。
  3. **绝不抢戏**：filler velocity 显著低于旋律（≤70）。
  4. **同帧并发**: melody + bass(root) + 一个 5th = 3 指；上限默认 4。

输出仍是 [{pitch, start, end, velocity}]，复音。
"""
from __future__ import annotations

from typing import List, Optional, Tuple, Set
from loguru import logger


# ── 区域定义 ───────────────────────────────────────────────
NATURAL_PCS: Set[int] = {0, 2, 4, 5, 7, 9, 11}
RH_WHITES = [72, 74, 76, 77, 79, 81, 83, 84]      # 旋律右手 C5..C6
LH_BASS_WHITES = [60, 62, 64, 65, 67, 69, 71]     # 根音左手 C4..B4
LH_FILL_WHITES = [62, 64, 65, 67, 69, 71]         # 5 度 / 内声部 D4..B4
SKY_WHITES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]
SKY_SET = set(SKY_WHITES)

# 力度（重要差距）
VEL_MELODY = 115
VEL_ROOT = 75
VEL_FIFTH = 55
VEL_THIRD = 50  # 通常不发；保留备用


def _nearest_in(pitch: int, allowed: List[int]) -> int:
    return min(allowed, key=lambda k: abs(k - pitch))


def _fold_to(pitch: int, allowed: List[int]) -> int:
    """把任意 MIDI pitch 折叠到 allowed 白键集合。"""
    if not allowed:
        return pitch
    lo, hi = min(allowed), max(allowed)
    while pitch < lo:
        pitch += 12
    while pitch > hi:
        pitch -= 12
    return _nearest_in(pitch, allowed)


# ── 旋律预处理 ─────────────────────────────────────────────

def _melody_to_white(notes: List[dict], bpm: float, grid: int) -> List[dict]:
    """把旋律 note 列表整体折叠到 RH_WHITES，做轻量量化与去重叠。
    保留每个 note 的原始时长（不再按 sub-beat 拆碎），只把 start/end 量化到网格。
    """
    if not notes:
        return []
    sec_per_beat = 60.0 / max(bpm, 1.0)
    step = sec_per_beat * 4.0 / grid
    out: List[dict] = []
    for n in notes:
        p = _fold_to(int(n["pitch"]), RH_WHITES)
        s = round(float(n["start"]) / step) * step
        e = round(float(n["end"]) / step) * step
        if e <= s:
            e = s + step
        out.append({
            "pitch": p,
            "start": float(s),
            "end": float(e),
            "velocity": VEL_MELODY,
        })
    out.sort(key=lambda x: x["start"])
    # 去重叠：旋律保持单线条，后开音符若与前音重叠则前音截止
    for i in range(len(out) - 1):
        if out[i]["end"] > out[i + 1]["start"]:
            out[i]["end"] = out[i + 1]["start"]
    out = [n for n in out if n["end"] - n["start"] > 1e-3]
    return out


def _melody_top_from_poly(poly_notes: List[dict], bpm: float, grid: int) -> List[dict]:
    """没有显式旋律线时，从复音 notes 中按时间网格取每帧最高音作旋律候选。"""
    if not poly_notes:
        return []
    sec_per_beat = 60.0 / max(bpm, 1.0)
    step = sec_per_beat * 4.0 / grid
    t_end = max(n["end"] for n in poly_notes)
    n_frames = max(1, int(round(t_end / step)) + 1)
    top_per_frame: List[Optional[int]] = [None] * n_frames
    for n in poly_notes:
        s = max(0, int(round(n["start"] / step)))
        e = min(n_frames, max(s + 1, int(round(n["end"] / step))))
        for f in range(s, e):
            cur = top_per_frame[f]
            if cur is None or int(n["pitch"]) > cur:
                top_per_frame[f] = int(n["pitch"])
    # 帧→note：连续相同 pitch 合并
    melody: List[dict] = []
    cur_p: Optional[int] = None
    cur_s = 0
    for f in range(n_frames):
        p = top_per_frame[f]
        if p == cur_p:
            continue
        if cur_p is not None:
            melody.append({"pitch": cur_p, "start": cur_s * step, "end": f * step, "velocity": 90})
        cur_p = p
        cur_s = f
    if cur_p is not None:
        melody.append({"pitch": cur_p, "start": cur_s * step, "end": n_frames * step, "velocity": 90})
    melody = [n for n in melody if n["end"] - n["start"] >= 0.06]
    return melody


# ── 和弦伴奏构造 ──────────────────────────────────────────

def _chord_pad_notes(
    chord_segments: List[dict],
    max_simultaneous: int,
    bpm: float,
    grid: int,
) -> List[dict]:
    """每段 chord 输出 [root]（必有） + [5th]（max>=3） + [3rd]（max>=4）。
    每个声部按整段持续。
    """
    if not chord_segments:
        return []
    sec_per_beat = 60.0 / max(bpm, 1.0)
    step = sec_per_beat * 4.0 / grid

    from . import chord_detector
    pads: List[dict] = []
    for seg in chord_segments:
        s_t = float(seg["start"])
        e_t = float(seg["end"])
        if e_t - s_t < 0.15:
            continue
        tones = chord_detector.chord_tones(seg)
        if not tones:
            continue
        s_q = round(s_t / step) * step
        e_q = round(e_t / step) * step
        if e_q <= s_q:
            e_q = s_q + step

        root_pc = tones[0]
        root_p = _nearest_in(60 + (root_pc % 12), LH_BASS_WHITES)

        fifth_p = None
        if len(tones) >= 3:
            fifth_pc = tones[2]
            fifth_p = _nearest_in(60 + (fifth_pc % 12), LH_FILL_WHITES)
            if fifth_p == root_p:
                fifth_p = None

        third_p = None
        if len(tones) >= 2:
            third_pc = tones[1]
            third_p = _nearest_in(60 + (third_pc % 12), LH_FILL_WHITES)
            if third_p in (root_p, fifth_p):
                third_p = None

        slots: list[tuple[int, int]] = [(root_p, VEL_ROOT)]
        if max_simultaneous >= 3 and fifth_p is not None:
            slots.append((fifth_p, VEL_FIFTH))
        if max_simultaneous >= 4 and third_p is not None:
            slots.append((third_p, VEL_THIRD))

        for p, v in slots:
            pads.append({
                "pitch": int(p),
                "start": float(s_q),
                "end": float(e_q),
                "velocity": int(v),
            })

    return pads


# ── 主入口 ─────────────────────────────────────────────────

def reduce(
    poly_notes: List[dict],
    bpm: float,
    chord_segments: Optional[List[dict]] = None,
    melody_notes: Optional[List[dict]] = None,
    grid: int = 16,
    max_simultaneous: int = 4,
    add_chord_pads: bool = True,
    melody_set: Optional[Set[int]] = None,  # 兼容旧调用，已弃用
) -> Tuple[List[dict], int]:
    """主入口（v3）。返回 (notes, max_concurrent)。"""
    # 1) 取得权威旋律
    if melody_notes:
        mel = _melody_to_white(melody_notes, bpm=bpm, grid=grid)
        logger.info(f"[voicing] melody source = explicit ({len(melody_notes)} → {len(mel)} after white-fold)")
    elif poly_notes:
        mel_raw = _melody_top_from_poly(poly_notes, bpm=bpm, grid=grid)
        mel = _melody_to_white(mel_raw, bpm=bpm, grid=grid)
        logger.info(f"[voicing] melody source = top-of-poly ({len(poly_notes)} poly → {len(mel)} mel)")
    else:
        mel = []

    if not mel and not chord_segments:
        return [], 0

    # 2) 构造和弦 pad
    pads: List[dict] = []
    if add_chord_pads and chord_segments:
        pads = _chord_pad_notes(chord_segments, max_simultaneous, bpm, grid)

    # 3) 合并旋律 + pad
    out_notes: List[dict] = []
    for n in mel:
        out_notes.append({
            "pitch": int(n["pitch"]),
            "start": float(n["start"]),
            "end": float(n["end"]),
            "velocity": int(n.get("velocity", VEL_MELODY)),
        })
    for p in pads:
        # 与同时段同音的 melody 冲突就跳过（实际上 pad 在 LH 区，几乎不冲突）
        skip = False
        for m in mel:
            if m["pitch"] == p["pitch"] and not (p["end"] <= m["start"] or p["start"] >= m["end"]):
                skip = True
                break
        if skip:
            continue
        out_notes.append({
            "pitch": int(p["pitch"]),
            "start": float(p["start"]),
            "end": float(p["end"]),
            "velocity": int(p["velocity"]),
        })

    out_notes.sort(key=lambda x: (x["start"], -x["pitch"]))

    # 4) 并发统计 + 兜底裁剪
    def _peak(notes: List[dict]) -> int:
        events: list[tuple[float, int]] = []
        for n in notes:
            events.append((n["start"], +1))
            events.append((n["end"], -1))
        events.sort(key=lambda x: (x[0], x[1]))
        cur = 0
        peak = 0
        for _, d in events:
            cur += d
            if cur > peak:
                peak = cur
        return peak

    peak = _peak(out_notes)
    if peak > max_simultaneous:
        logger.warning(f"[voicing] peak {peak} > cap {max_simultaneous}, trimming pads")
        if max_simultaneous < 4:
            out_notes = [n for n in out_notes if n["velocity"] != VEL_THIRD]
        if max_simultaneous < 3:
            out_notes = [n for n in out_notes if n["velocity"] != VEL_FIFTH]
        peak = _peak(out_notes)

    return out_notes, int(peak)


# ── 兼容工具：保留旧 API ───────────────────────────────────

def split_melody_top(notes: List[dict], grid_sec: float = 0.05) -> Set[int]:
    """旧 API：返回 'top-pitch idx 集合'。v3 内部不再使用，但保留以兼容外部调用。"""
    if not notes:
        return set()
    t_end = max(n["end"] for n in notes)
    n_frames = max(1, int(t_end / grid_sec) + 1)
    melody_idx: Set[int] = set()
    for f in range(n_frames):
        t0 = f * grid_sec
        t1 = t0 + grid_sec
        best_idx = -1
        best_pitch = -1
        for idx, n in enumerate(notes):
            if n["start"] < t1 and n["end"] > t0:
                if n["pitch"] > best_pitch:
                    best_pitch = n["pitch"]
                    best_idx = idx
        if best_idx >= 0:
            melody_idx.add(best_idx)
    return melody_idx
