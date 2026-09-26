"""Bounded, asynchronous upload jobs. Run with exactly one Uvicorn worker."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
import shutil
from threading import Lock
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .pipeline import MAX_POINTS, MAX_UPLOAD_BYTES, RUNTIME, Runtime, SetupError, process_scan

LOGGER = logging.getLogger(__name__)
RESULT_TTL = 3600
MAX_RESULTS = 4


@dataclass
class Job:
    directory: Path
    created: float = field(default_factory=time.time)
    finished: float | None = None
    stage: str = "uploading"
    messages: list = field(default_factory=list)
    error: str | None = None


class Jobs:
    def __init__(self):
        self.root = RUNTIME / "jobs"
        self.lock = Lock()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.runtime = Runtime()
        self.jobs = {}

    def cleanup(self):
        # Called under lock. Active uploads and inference are never removed.
        completed = sorted(
            ((key, job) for key, job in self.jobs.items() if job.finished is not None),
            key=lambda pair: pair[1].finished,
        )
        for index, (key, job) in enumerate(completed):
            if time.time() - job.finished > RESULT_TTL or index < len(completed) - MAX_RESULTS:
                shutil.rmtree(job.directory, ignore_errors=True)
                del self.jobs[key]

    def update(self, key, stage, message):
        with self.lock:
            job = self.jobs[key]
            job.stage = stage
            job.messages.append({"stage": stage, "message": message})

    def run(self, key, source, filename):
        try:
            process_scan(source, self.jobs[key].directory, self.runtime,
                         lambda stage, message: self.update(key, stage, message),
                         source_name=filename)
        except (ValueError, SetupError) as exc:
            self.fail(key, str(exc))
        except Exception:
            LOGGER.exception("Inference job %s failed", key)
            self.fail(key, "Processing failed. Check the backend log for model or grid engine details.")
        finally:
            source.unlink(missing_ok=True)
            with self.lock:
                self.jobs[key].finished = time.time()
                self.cleanup()

    def fail(self, key, message):
        self.update(key, "failed", message)
        with self.lock:
            self.jobs[key].error = message


@asynccontextmanager
async def lifespan(app):
    store = Jobs()
    store.root.mkdir(parents=True, exist_ok=True)
    # Job IDs live only in this process; discard files from previous service runs.
    for directory in store.root.iterdir():
        if directory.is_dir() and len(directory.name) == 32:
            shutil.rmtree(directory)
    app.state.jobs = store
    try:
        yield
    finally:
        store.executor.shutdown(wait=True)


app = FastAPI(title="Point Matrix live inference", lifespan=lifespan)
origins = [value.strip() for value in os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])


@app.get("/api/health")
def health(request: Request):
    store = request.app.state.jobs
    with store.lock:
        store.cleanup()
        busy = any(job.finished is None for job in store.jobs.values())
    return {"status": "online", "busy": busy, "model_loaded": store.runtime.model is not None,
            "max_upload_bytes": MAX_UPLOAD_BYTES, "max_points": MAX_POINTS}


@app.post("/api/jobs", status_code=202)
async def upload(request: Request, filename: str):
    # Stream the raw body to enforce the limit without buffering arbitrary multipart data.
    suffix = Path(filename).suffix.lower()
    if suffix not in {".bin", ".npy"}:
        raise HTTPException(415, "Use a raw .bin or .npy file.")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            size = int(content_length)
        except ValueError:
            raise HTTPException(400, "Invalid Content-Length.")
        if size <= 0:
            raise HTTPException(400, "Upload is empty.")
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Upload must be no larger than 16 MiB.")
    store = request.app.state.jobs
    key = uuid4().hex
    with store.lock:
        store.cleanup()
        if any(job.finished is None for job in store.jobs.values()):
            raise HTTPException(429, "The inference worker is busy. Try again when the current scan finishes.")
        directory = store.root / key
        directory.mkdir(parents=True)
        store.jobs[key] = Job(directory)
    source = directory / f"input{suffix}"
    try:
        size = 0
        with source.open("wb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Upload exceeds 16 MiB.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(400, "Upload is empty.")
        store.update(key, "queued", "Upload received. Starting the inference pipeline.")
        store.executor.submit(store.run, key, source, Path(filename).name[:255])
    except (Exception, asyncio.CancelledError):
        with store.lock:
            shutil.rmtree(directory, ignore_errors=True)
            del store.jobs[key]
        raise
    return {"id": key}


@app.get("/api/jobs/{key}")
def status(key: str, request: Request):
    store = request.app.state.jobs
    with store.lock:
        store.cleanup()
        job = store.jobs.get(key)
        if job is None:
            raise HTTPException(404, "Job not found or expired. Upload the scan again.")
        return {"id": key, "stage": job.stage, "messages": list(job.messages), "error": job.error}


ARTIFACTS = {
    "classified.npy", "grid.npz", "report.json", "run_pipeline.py", "outputs.zip",
    "frames/manifest.json", "frames/grid/upload_grid.bin",
    "frames/points/upload_points.bin", "frames/meta/upload_meta.json",
}


@app.get("/api/jobs/{key}/files/{artifact:path}")
def artifact_file(key: str, artifact: str, request: Request):
    store = request.app.state.jobs
    with store.lock:
        store.cleanup()
        job = store.jobs.get(key)
        if job is None:
            raise HTTPException(404, "Job not found or expired.")
        if job.stage != "complete":
            raise HTTPException(409, "The output is not ready.")
        if artifact not in ARTIFACTS:
            raise HTTPException(404, "Output file not found.")
        path = job.directory / artifact
    return FileResponse(path, filename=path.name)
