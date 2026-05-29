import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from loguru import logger

from .models import ProcessRequest, ProcessResponse
from .pipeline import processor

app = FastAPI(title="Cuby Transcribe Agent", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "python-agent"}


@app.post("/internal/process", response_model=ProcessResponse)
def process(req: ProcessRequest):
    try:
        result = processor.run(req.audioPath, req.options, task_id=req.taskId)
        return ProcessResponse(success=True, **result)
    except Exception as e:
        logger.exception("process failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/internal/stems/{task_id}/{name}")
def get_stem(task_id: str, name: str):
    """提供分离后的音轨文件下载/播放。"""
    if "/" in task_id or "/" in name or ".." in task_id or ".." in name:
        raise HTTPException(400, "invalid path")
    base = os.path.join(processor.STEMS_ROOT, task_id, name)
    if not os.path.isfile(base):
        raise HTTPException(404, "stem not found")
    return FileResponse(base, media_type="audio/wav")
