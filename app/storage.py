"""Temporary session storage on local disk, behind a small interface.

Each document gets a folder under DATA_DIR/sessions/<doc_id>/ holding the
upload, rendered pages, chart crops, and JSON records. Records are also kept in
memory for fast reads. Everything is removed on request or after the TTL.
Swapping this class for a cloud bucket later only needs the same methods.
"""

from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

from .models import Chart, Document


class Storage:
    def __init__(self, root: Path, ttl_minutes: int):
        self.root = root
        self.ttl_seconds = ttl_minutes * 60
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._docs: dict[str, Document] = {}
        self._charts: dict[str, Chart] = {}

    # -- files ---------------------------------------------------------------
    def doc_dir(self, doc_id: str) -> Path:
        d = self.root / doc_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def path(self, doc_id: str, name: str) -> Path:
        return self.doc_dir(doc_id) / name

    def write_bytes(self, doc_id: str, name: str, data: bytes) -> Path:
        p = self.path(doc_id, name)
        p.write_bytes(data)
        return p

    # -- records -------------------------------------------------------------
    def save_document(self, doc: Document) -> None:
        with self._lock:
            self._docs[doc.id] = doc
            if (self.root / doc.id).exists():
                self.path(doc.id, "document.json").write_text(doc.model_dump_json())

    def get_document(self, doc_id: str) -> Document | None:
        with self._lock:
            return self._docs.get(doc_id)

    def save_chart(self, chart: Chart) -> None:
        with self._lock:
            self._charts[chart.id] = chart
            if (self.root / chart.document_id).exists():
                self.path(chart.document_id, f"{chart.id}.json").write_text(chart.model_dump_json())

    def get_chart(self, chart_id: str) -> Chart | None:
        with self._lock:
            return self._charts.get(chart_id)

    def chart_image_path(self, chart: Chart) -> Path:
        return self.root / chart.document_id / f"{chart.id}.png"

    # -- deletion ------------------------------------------------------------
    def delete_document(self, doc_id: str) -> bool:
        with self._lock:
            doc = self._docs.pop(doc_id, None)
            for cid in list(self._charts):
                if self._charts[cid].document_id == doc_id:
                    del self._charts[cid]
        d = self.root / doc_id
        existed = d.exists()
        shutil.rmtree(d, ignore_errors=True)
        return doc is not None or existed

    def expired_ids(self, now: float | None = None) -> list[str]:
        now = now or time.time()
        ids = set()
        with self._lock:
            for doc in self._docs.values():
                if now - doc.created > self.ttl_seconds:
                    ids.add(doc.id)
        # Folders left over from a previous run of the server.
        if self.root.exists():
            for d in self.root.iterdir():
                if d.is_dir() and now - d.stat().st_mtime > self.ttl_seconds and d.name not in self._docs:
                    ids.add(d.name)
        return sorted(ids)

    def sweep(self) -> list[str]:
        removed = self.expired_ids()
        for doc_id in removed:
            self.delete_document(doc_id)
        return removed
