"""Krumhansl-Schmuckler 调性检测。"""
from __future__ import annotations
from typing import List, Dict

MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _correlate(profile, histogram):
    n = 12
    mean_p = sum(profile) / n
    mean_h = sum(histogram) / n
    num = sum((profile[i] - mean_p) * (histogram[i] - mean_h) for i in range(n))
    denom_p = (sum((profile[i] - mean_p) ** 2 for i in range(n))) ** 0.5
    denom_h = (sum((histogram[i] - mean_h) ** 2 for i in range(n))) ** 0.5
    if denom_p == 0 or denom_h == 0:
        return 0.0
    return num / (denom_p * denom_h)


def detect_key(notes: List[dict]) -> Dict:
    """返回 {key, mode, confidence, transposeToC} ，transposeToC 是要把音乐移到 C/Am 的半音数。"""
    histogram = [0.0] * 12
    for n in notes:
        dur = max(0.05, n["end"] - n["start"])
        histogram[n["pitch"] % 12] += dur

    best = {"score": -2.0, "tonic": 0, "mode": "major"}
    for tonic in range(12):
        rot = histogram[tonic:] + histogram[:tonic]
        maj = _correlate(MAJOR_PROFILE, rot)
        minr = _correlate(MINOR_PROFILE, rot)
        if maj > best["score"]:
            best = {"score": maj, "tonic": tonic, "mode": "major"}
        if minr > best["score"]:
            best = {"score": minr, "tonic": tonic, "mode": "minor"}

    tonic = best["tonic"]
    # major: 转到 C (0)；minor: 转到 A (9)
    target = 0 if best["mode"] == "major" else 9
    transpose = (target - tonic) % 12
    if transpose > 6:
        transpose -= 12

    return {
        "key": PITCH_NAMES[tonic],
        "mode": best["mode"],
        "confidence": round(max(0.0, best["score"]), 3),
        "transposeToC": transpose,
    }
