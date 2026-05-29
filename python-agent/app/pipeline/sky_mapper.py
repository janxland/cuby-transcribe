"""15 键映射：音域适配 + 变化音就近匹配 + 简化 + 量化。"""
from __future__ import annotations
from typing import List

SKY_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]
SKY_SET = set(SKY_KEYS)
SKY_MIN, SKY_MAX = 60, 84
NATURAL_PCS = {0, 2, 4, 5, 7, 9, 11}


def transpose(notes: List[dict], semitones: int) -> List[dict]:
    return [{**n, "pitch": n["pitch"] + semitones} for n in notes]


def adapt_range(notes: List[dict]) -> List[dict]:
    if not notes:
        return notes
    pitches = [n["pitch"] for n in notes]
    center = sum(pitches) / len(pitches)
    target = (SKY_MIN + SKY_MAX) / 2  # 72
    octave_shift = round((target - center) / 12) * 12
    shifted = [{**n, "pitch": n["pitch"] + octave_shift} for n in notes]

    # 极端音折叠到范围内
    out = []
    for n in shifted:
        p = n["pitch"]
        while p < SKY_MIN:
            p += 12
        while p > SKY_MAX:
            p -= 12
        out.append({**n, "pitch": p})
    return out


def resolve_accidentals(notes: List[dict]) -> List[dict]:
    """变化音就近匹配到 C 大调自然音，根据旋律方向决定。"""
    out = []
    for i, n in enumerate(notes):
        p = n["pitch"]
        if (p % 12) in NATURAL_PCS:
            out.append(n)
            continue
        prev_p = notes[i - 1]["pitch"] if i > 0 else p
        next_p = notes[i + 1]["pitch"] if i + 1 < len(notes) else p
        # 旋律方向：上行倾向向上解决
        direction = 1 if next_p >= prev_p else -1
        up = p + 1
        down = p - 1
        # 确保在范围
        if direction > 0 and up <= SKY_MAX and (up % 12) in NATURAL_PCS:
            p = up
        elif direction < 0 and down >= SKY_MIN and (down % 12) in NATURAL_PCS:
            p = down
        elif (up % 12) in NATURAL_PCS and up <= SKY_MAX:
            p = up
        elif (down % 12) in NATURAL_PCS and down >= SKY_MIN:
            p = down
        out.append({**n, "pitch": p})
    return out


def simplify_melody(notes: List[dict], min_duration: float = 0.12) -> List[dict]:
    if not notes:
        return notes
    # 去掉过短装饰音
    filtered = [n for n in notes if (n["end"] - n["start"]) >= min_duration]
    if not filtered:
        return notes
    # 合并 50ms 内同音
    merged = [dict(filtered[0])]
    for n in filtered[1:]:
        last = merged[-1]
        if n["pitch"] == last["pitch"] and (n["start"] - last["end"]) < 0.05:
            last["end"] = max(last["end"], n["end"])
        else:
            merged.append(dict(n))
    return merged


def quantize_rhythm(notes: List[dict], bpm: float, grid: int = 16) -> List[dict]:
    if bpm <= 0:
        return notes
    sec_per_beat = 60.0 / bpm
    step = sec_per_beat * 4 / grid  # 每格秒
    out = []
    for n in notes:
        start = round(n["start"] / step) * step
        end = round(n["end"] / step) * step
        if end <= start:
            end = start + step
        out.append({**n, "start": start, "end": end})
    return out


def constrain_to_sky(notes: List[dict]) -> List[dict]:
    """最终保证全部音符落在 SKY_KEYS 集合内。"""
    out = []
    for n in notes:
        p = n["pitch"]
        if p in SKY_SET:
            out.append(n)
            continue
        # 找最近
        nearest = min(SKY_KEYS, key=lambda k: abs(k - p))
        out.append({**n, "pitch": nearest})
    return out


def process(notes: List[dict], bpm: float, simplify: bool = True, grid: int = 16) -> List[dict]:
    if not notes:
        return notes
    notes = adapt_range(notes)
    notes = resolve_accidentals(notes)
    if simplify:
        notes = simplify_melody(notes)
    notes = quantize_rhythm(notes, bpm, grid)
    notes = constrain_to_sky(notes)
    notes.sort(key=lambda n: n["start"])
    return notes
