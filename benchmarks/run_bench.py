"""基准测试：生成不同长度的合成音频，测量整条流水线耗时。

用法：
  cd python-agent && source .venv/bin/activate
  python ../benchmarks/run_bench.py
"""
from __future__ import annotations
import os
import sys
import time
import json
import tempfile
import numpy as np
import soundfile as sf

# 让脚本能 import python-agent.app
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python-agent"))

from app.pipeline import processor  # noqa: E402
from app.models import ProcessOptions  # noqa: E402


def synth_melody(seconds: float, sr: int = 22050) -> np.ndarray:
    """合成一段 C 大调旋律。每个音 0.5s，对应一个 MIDI 音符。"""
    melody_midi = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    note_dur = 0.5
    n_notes = max(1, int(seconds / note_dur))
    y = np.zeros(int(sr * seconds), dtype=np.float32)
    t_per_note = np.linspace(0, note_dur, int(sr * note_dur), endpoint=False)
    env = np.minimum(1.0, np.linspace(0, 2, len(t_per_note))) * np.exp(-t_per_note * 1.5)
    for i in range(n_notes):
        midi = melody_midi[i % len(melody_midi)]
        freq = 440.0 * (2 ** ((midi - 69) / 12))
        tone = 0.25 * np.sin(2 * np.pi * freq * t_per_note) * env
        start = int(i * note_dur * sr)
        end = min(len(y), start + len(tone))
        y[start:end] += tone[: end - start]
    return y


def bench_one(seconds: float) -> dict:
    sr = 22050
    y = synth_melody(seconds, sr)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    try:
        sf.write(path, y, sr)
        t0 = time.time()
        result = processor.run(path, ProcessOptions())
        elapsed = time.time() - t0
        meta = result["metadata"]
        return {
            "audio_seconds": round(seconds, 2),
            "elapsed_seconds": round(elapsed, 2),
            "rtf": round(elapsed / seconds, 3),  # real-time factor (< 1 表示快过实时)
            "note_count": meta["noteCount"],
            "detected_key": f"{meta['detectedKey']} {meta['detectedMode']}",
            "bpm": meta["bpm"],
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def main():
    print("=" * 78)
    print("Cuby Transcribe · 基准测试")
    print("=" * 78)
    durations = [5, 10, 30, 60]
    results = []
    for d in durations:
        print(f"\n→ 测试 {d}s 音频…")
        try:
            r = bench_one(d)
        except Exception as e:
            r = {"audio_seconds": d, "error": str(e)}
        results.append(r)
        print(f"  {r}")

    print("\n" + "=" * 78)
    print(f"{'音频':>8} {'耗时':>10} {'RTF':>8} {'音符':>6} {'调性':>10} {'BPM':>8}")
    print("-" * 78)
    for r in results:
        if "error" in r:
            print(f"{r['audio_seconds']:>6}s  ERROR: {r['error']}")
        else:
            print(
                f"{r['audio_seconds']:>6}s {r['elapsed_seconds']:>9}s "
                f"{r['rtf']:>8} {r['note_count']:>6} "
                f"{r['detected_key']:>10} {r['bpm']:>8}"
            )
    print("=" * 78)

    out = os.path.join(HERE, "results.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nresults → {out}")


if __name__ == "__main__":
    main()
