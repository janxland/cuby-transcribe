"""音轨分离：使用 Meta Demucs - 当前业界最强开源人声/乐器分离。

模式：
  - vocals  : 二轨分离 (vocals / no_vocals)，速度最快
  - 4stems  : 四轨分离 (vocals / drums / bass / other)，htdemucs
  - 6stems  : 六轨分离 (vocals / drums / bass / other / piano / guitar)，htdemucs_6s
"""
from __future__ import annotations
import os
import subprocess
import sys
import shutil
from typing import Dict, Iterable, Literal, Optional
from loguru import logger


SeparationMode = Literal["none", "vocals", "4stems", "6stems"]

# mode → 默认 demucs 模型名
MODE_MODELS: Dict[str, str] = {
    "vocals": "htdemucs",
    "4stems": "htdemucs",
    "6stems": "htdemucs_6s",
}


def _device() -> str:
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"        # Apple Silicon GPU
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
    except Exception:
        return "cpu"


DEFAULT_MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs")
MAX_RETRIES = int(os.environ.get("DEMUCS_RETRIES", "3"))


def _default_jobs() -> int:
    """CPU 上让 demucs 并行：默认用一半物理核（留资源给 BPM 线程 / OS）。"""
    n = os.cpu_count() or 2
    return max(1, n // 2)


DEMUCS_JOBS = int(os.environ.get("DEMUCS_JOBS", str(_default_jobs())))
DEMUCS_OVERLAP = os.environ.get("DEMUCS_OVERLAP", "0.10")   # 默认 0.25，降到 0.10 显著提速
DEMUCS_SHIFTS = os.environ.get("DEMUCS_SHIFTS", "1")        # 1 = 不做随机平均，最快


def _prefetch_model(model: str) -> None:
    """预下载模型并对网络抖动做重试。命中缓存即立即返回。"""
    last_err: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            from demucs.pretrained import get_model
            get_model(model)
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"[demucs] prefetch attempt {attempt}/{MAX_RETRIES} failed: {e}")
            # 清掉 torch hub 里可能残留的 .tmp / 0 字节文件
            cache_dir = os.path.expanduser("~/.cache/torch/hub/checkpoints")
            if os.path.isdir(cache_dir):
                for f in os.listdir(cache_dir):
                    fp = os.path.join(cache_dir, f)
                    if f.endswith(".tmp") or (os.path.isfile(fp) and os.path.getsize(fp) == 0):
                        try: os.remove(fp)
                        except OSError: pass
    raise RuntimeError(f"failed to download demucs model `{model}` after {MAX_RETRIES} attempts: {last_err}")


def separate(
    audio_path: str,
    output_dir: str,
    mode: SeparationMode = "vocals",
    model: Optional[str] = None,
    keep_stems: Optional[Iterable[str]] = None,
) -> Dict[str, str]:
    """运行 Demucs。返回 {stem_name: absolute_path_to_wav}。

    keep_stems: 仅保留指定名字的 stems；其它会被删除以省盘/带宽。
                None 表示保留全部输出。
    """
    os.makedirs(output_dir, exist_ok=True)
    device = _device()
    # 优先 mode→model 映射；用户显式 model 优先
    model = model or MODE_MODELS.get(mode, DEFAULT_MODEL)

    # 第一次会下载模型，做重试避免 CDN 抖动
    _prefetch_model(model)

    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", model,
        "-d", device,
        "-o", output_dir,
        "--filename", "{stem}.{ext}",     # 平铺命名
        "--overlap", str(DEMUCS_OVERLAP),
        "--shifts", str(DEMUCS_SHIFTS),
    ]
    # GPU 上多 worker 反而抢显存；只在 CPU 路径开 -j
    if device == "cpu" and DEMUCS_JOBS > 1:
        cmd += ["-j", str(DEMUCS_JOBS)]
    if mode == "vocals":
        cmd += ["--two-stems=vocals"]

    cmd.append(audio_path)

    logger.info(f"[demucs] device={device} model={model} mode={mode} jobs={DEMUCS_JOBS} → {output_dir}")
    logger.info("[demucs] cmd: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        logger.error(proc.stderr[-2000:])
        raise RuntimeError(f"demucs failed: {proc.stderr.strip().splitlines()[-1] if proc.stderr else 'unknown'}")

    # Demucs 输出到 output_dir/<model>/<track_basename>/<stem>.wav
    track_name = os.path.splitext(os.path.basename(audio_path))[0]
    sub = os.path.join(output_dir, model, track_name)
    if not os.path.isdir(sub):
        # 兜底：在 output_dir 里搜
        for root, _, files in os.walk(output_dir):
            if any(f.endswith(".wav") for f in files):
                sub = root
                break

    # 把所有 stems 复制到 output_dir 根目录下，方便 URL 路由
    stems: Dict[str, str] = {}
    keep_set = {s for s in keep_stems} if keep_stems else None
    for fn in os.listdir(sub):
        if not fn.endswith(".wav"):
            continue
        stem_name = os.path.splitext(fn)[0]  # vocals / drums / bass / other / piano / guitar / no_vocals
        src = os.path.join(sub, fn)
        if keep_set is not None and stem_name not in keep_set:
            try: os.remove(src)
            except OSError: pass
            continue
        dst = os.path.join(output_dir, f"{stem_name}.wav")
        if src != dst:
            shutil.move(src, dst)
        stems[stem_name] = dst

    # 清理 demucs 留下的空目录
    shutil.rmtree(os.path.join(output_dir, model), ignore_errors=True)

    logger.info(f"[demucs] done: {list(stems.keys())}")
    return stems


def default_stem_for_mode(mode: SeparationMode) -> str:
    """根据分离模式，给出默认要转录的 stem。"""
    if mode == "vocals":
        return "vocals"
    if mode == "4stems":
        return "vocals"
    return "original"
