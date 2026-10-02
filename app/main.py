"""FastAPI app: API routes (SPEC section 8) and the static website."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import MAX_PDF_PAGES, MAX_UPLOAD_BYTES, ROOT, SAMPLES, load_settings
from .fixtures_provider import FixtureProvider
from .gemini import GeminiProvider, ResponseCache
from .limits import Limits, client_id
from .imaging import UnreadableFile, load_image, pdf_page_count, pixel_hash
from .models import AskRequest, Document
from .pipeline.runner import Pipeline
from .storage import Storage

log = logging.getLogger("hear")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WEB = ROOT / "web"
SAMPLES_DIR = WEB / "samples"


class AppState:
    def __init__(self):
        self.settings = load_settings()
        self.storage = Storage(self.settings.sessions_dir, self.settings.session_ttl_minutes)
        self.cache = ResponseCache(self.settings.cache_dir, self.settings.seed_cache_dirs)
        self.mode = self.settings.app_mode
        self.mode_note = ""
        self.provider = None
        self.fixture = FixtureProvider()
        if self.mode == "live":
            try:
                gp = GeminiProvider(self.settings, self.cache)
                ok, note = _with_timeout(gp.check, 15, (False, "Timed out reaching Gemini."))
                if ok:
                    self.provider = gp
                    self.mode_note = note
                else:
                    self.mode = "fixture"
                    what = "Google Cloud credentials" if self.settings.backend == "cloud" else "Gemini key"
                    self.mode_note = f"The {what} did not work. {note} Showing fixture data instead."
            except Exception as e:  # SDK missing or misconfigured
                self.mode = "fixture"
                self.mode_note = f"Gemini could not be started ({type(e).__name__}). Showing fixture data instead."
        elif not self.settings.has_credentials:
            self.mode_note = ("GOOGLE_GENAI_USE_ENTERPRISE is set but GOOGLE_CLOUD_PROJECT is not."
                              if self.settings.backend == "cloud" else "No Gemini API key is set.")
        if self.provider is None:
            self.provider = self.fixture
        delay = float(os.getenv("FIXTURE_STEP_DELAY", "0.4")) if self.mode == "fixture" else 0.0
        self.pipeline = Pipeline(self.storage, self.provider, self.mode, step_delay=delay)
        self.doc_hashes: dict[str, set[str]] = {}
        self.limits = Limits()
        log.info("mode=%s backend=%s model=%s %s", self.mode, self.settings.backend if self.mode == "live" else "fixture",
                 getattr(self.provider, "model", ""), self.mode_note)


def _with_timeout(fn, seconds, default):
    out = [default]

    def run():
        out[0] = fn()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(seconds)
    return out[0]


state: AppState | None = None


async def _sweeper():
    while True:
        await asyncio.sleep(60)
        try:
            removed = state.storage.sweep()
            for doc_id in removed:
                state.cache.delete_for_hashes(state.doc_hashes.pop(doc_id, set()))
            state.cache.sweep_uploads(state.settings.session_ttl_minutes * 60)
            if removed:
                log.info("deleted expired documents: %s", removed)
        except Exception as e:
            log.warning("sweep failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global state
    state = AppState()
    task = asyncio.create_task(_sweeper())
    yield
    task.cancel()


app = FastAPI(title="Hear the Graph", lifespan=lifespan)


def _err(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


def _sniff(data: bytes) -> str | None:
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _start(filename: str, data: bytes, is_sample: bool) -> Document:
    kind = _sniff(data)
    if kind is None:
        _err(415, "This file type is not supported. Upload a PDF, PNG, JPG, or WEBP file.")
    hashes: set[str] = set()
    if kind == "pdf":
        try:
            pages = pdf_page_count(data)
        except UnreadableFile as e:
            _err(422, str(e))
        if pages > MAX_PDF_PAGES:
            _err(413, f"This PDF has {pages} pages. The limit is {MAX_PDF_PAGES}. Split it and upload the part with the charts.")
        if pages == 0:
            _err(422, "This PDF has no pages.")
    else:
        try:
            hashes.add(pixel_hash(load_image(data)))
        except UnreadableFile as e:
            _err(422, str(e) + " Try exporting it again as PNG or JPG.")
    doc = Document(
        id=uuid.uuid4().hex[:12],
        filename=filename[:120] or "upload",
        kind="pdf" if kind == "pdf" else "image",
        is_sample=is_sample,
        mode=state.mode,
    )
    state.storage.doc_dir(doc.id)
    state.storage.write_bytes(doc.id, f"original.{kind}", data)
    state.storage.save_document(doc)
    state.doc_hashes[doc.id] = hashes
    threading.Thread(target=state.pipeline.process, args=(doc, data), daemon=True).start()
    return doc


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mode": state.mode,
        "mode_note": state.mode_note or getattr(state.provider, "model_note", ""),
        "model": getattr(state.provider, "model", ""),
        "backend": state.settings.backend if state.mode == "live" else "fixture",
        "backend_label": state.settings.backend_label if state.mode == "live" else "Fixture data (answer keys), no Gemini calls",
        "session_ttl_minutes": state.settings.session_ttl_minutes,
        "limits": {"max_mb": MAX_UPLOAD_BYTES // (1024 * 1024), "max_pages": MAX_PDF_PAGES, "types": ["PDF", "PNG", "JPG", "WEBP"]},
    }


@app.get("/api/samples")
def list_samples():
    return [{"name": k, "file": f, "label": label, "kind": "pdf" if f.endswith(".pdf") else "image"} for k, (f, label) in SAMPLES.items()]


def _limit(kind: str, request: Request) -> None:
    refusal = state.limits.check(kind, client_id(request))
    if refusal:
        _err(429, refusal)


@app.post("/api/documents", status_code=201)
async def upload(request: Request, file: UploadFile = File(...)):
    _limit("document", request)
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > MAX_UPLOAD_BYTES:
            _err(413, "This file is larger than 20 MB. Compress it or upload only the pages with charts.")
    if not data:
        _err(422, "The file is empty. Choose the file again.")
    doc = _start(file.filename or "upload", bytes(data), is_sample=False)
    return {"id": doc.id, "status": doc.status}


@app.post("/api/samples/{name}", status_code=201)
def start_sample(name: str, request: Request):
    _limit("document", request)
    if name not in SAMPLES:
        _err(404, "There is no sample with that name.")
    fname, _ = SAMPLES[name]
    data = (SAMPLES_DIR / fname).read_bytes()
    doc = _start(fname, data, is_sample=True)
    return {"id": doc.id, "status": doc.status}


def _doc_payload(doc: Document) -> dict:
    charts = []
    for cid in doc.chart_ids:
        c = state.storage.get_chart(cid)
        if c:
            charts.append({
                "id": c.id, "page": c.page, "index": c.index, "chart_type": c.chart_type, "title": c.title,
                "status": c.status, "error": c.error, "level": c.confidence.level,
                "message": c.confidence.message, "source": c.source, "retryable": c.retryable,
                "n_series": len(c.series), "n_points": sum(len(s.points) for s in c.series),
            })
    d = doc.model_dump()
    d["charts"] = charts
    d["expires_at"] = doc.created + state.settings.session_ttl_minutes * 60
    return d


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str):
    doc = state.storage.get_document(doc_id)
    if not doc:
        _err(404, "This document was not found. It may have been deleted or expired. Upload it again.")
    return _doc_payload(doc)


@app.get("/api/documents/{doc_id}/events")
async def document_events(doc_id: str, request: Request):
    if not state.storage.get_document(doc_id):
        _err(404, "This document was not found.")

    async def stream():
        last = None
        while True:
            if await request.is_disconnected():
                break
            doc = state.storage.get_document(doc_id)
            if doc is None:
                yield "event: gone\ndata: {}\n\n"
                break
            payload = json.dumps(_doc_payload(doc))
            if payload != last:
                last = payload
                yield f"data: {payload}\n\n"
            if doc.status in ("done", "failed"):
                yield "event: end\ndata: {}\n\n"
                break
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    existed = state.storage.delete_document(doc_id)
    state.cache.delete_for_hashes(state.doc_hashes.pop(doc_id, set()))
    if not existed:
        _err(404, "This document was already deleted.")
    return {"deleted": True}


def _chart(chart_id: str):
    c = state.storage.get_chart(chart_id)
    if not c:
        _err(404, "This chart was not found. It may have been deleted or expired.")
    return c


@app.get("/api/charts/{chart_id}")
def get_chart(chart_id: str):
    c = _chart(chart_id)
    d = c.model_dump()
    doc = state.storage.get_document(c.document_id)
    d["document"] = {"id": c.document_id, "filename": doc.filename if doc else "", "chart_ids": doc.chart_ids if doc else []}
    d["mode"] = state.mode
    return d


@app.get("/api/charts/{chart_id}/image")
def chart_image(chart_id: str, variant: str = "original"):
    c = _chart(chart_id)
    p = state.storage.chart_image_path(c)
    if variant == "straightened":  # a straightened copy that was not adopted
        p = p.with_name(f"{c.id}-straight.png")
    elif variant == "photo":  # the original photo, when the straightened copy was adopted
        p = p.with_name(f"{c.id}-photo.png")
    if not p.exists():
        _err(404, "The image for this chart is no longer available.")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-store"})


_retrying: set[str] = set()
_retry_lock = threading.Lock()


@app.post("/api/charts/{chart_id}/retry")
def retry_chart(chart_id: str, request: Request):
    _limit("retry", request)
    """Read a chart again after Gemini was busy. Cached readings are reused."""
    c = _chart(chart_id)
    if state.mode != "live":
        _err(409, "Reading a chart again needs live mode with a Gemini API key.")
    if not c.retryable:
        _err(409, "This chart does not need to be read again.")
    with _retry_lock:
        if chart_id in _retrying:
            _err(409, "This chart is already being read again.")
        _retrying.add(chart_id)
    try:
        doc = state.storage.get_document(c.document_id)
        new = state.pipeline.retry_chart(c, "samples" if doc and doc.is_sample else "uploads")
    finally:
        with _retry_lock:
            _retrying.discard(chart_id)
    return {"id": new.id, "status": new.status, "error": new.error, "retryable": new.retryable,
            "level": new.confidence.level, "message": new.confidence.message}


@app.post("/api/charts/{chart_id}/ask")
def ask(chart_id: str, body: AskRequest, request: Request):
    _limit("ask", request)
    from .pipeline.qa import answer_question

    c = _chart(chart_id)
    if c.status != "ok":
        _err(409, "This chart could not be read, so questions cannot be answered.")
    bucket = "samples" if (doc := state.storage.get_document(c.document_id)) and doc.is_sample else "uploads"
    return answer_question(c, body.question, body.series, state.provider if state.mode == "live" else None, bucket).model_dump()


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
