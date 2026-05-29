from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .models import ProcessRequest, ProcessResponse
from .pipeline import processor

app = FastAPI(title="Cuby Transcribe Agent", version="0.1.0")

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
        result = processor.run(req.audioPath, req.options)
        return ProcessResponse(success=True, **result)
    except Exception as e:
        logger.exception("process failed")
        raise HTTPException(status_code=500, detail=str(e))
