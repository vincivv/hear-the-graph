"""API tests in fixture mode with a temporary data folder."""

import io
import time
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_module=None):
    import os
    os.environ["DATA_DIR"] = str(tmp_path_factory.mktemp("data"))
    os.environ["APP_MODE"] = "fixture"
    os.environ["FIXTURE_STEP_DELAY"] = "0"
    os.environ["LIMIT_DOCUMENTS_PER_HOUR"] = "0"
    os.environ.pop("GEMINI_API_KEY", None)
    from app.main import app
    with TestClient(app) as c:
        yield c


def wait(client, doc_id, timeout=30):
    t = time.time()
    while time.time() - t < timeout:
        d = client.get(f"/api/documents/{doc_id}").json()
        if d["status"] in ("done", "failed"):
            return d
        time.sleep(0.2)
    raise AssertionError("timed out")


def test_health_reports_fixture_mode(client):
    h = client.get("/api/health").json()
    assert h["mode"] == "fixture" and h["limits"]["max_mb"] == 20 and h["limits"]["max_pages"] == 40


def test_sample_pdf_yields_four_charts_on_pages_2_4_5(client):
    r = client.post("/api/samples/lecture")
    assert r.status_code == 201
    d = wait(client, r.json()["id"])
    assert d["status"] == "done"
    assert sorted(c["page"] for c in d["charts"]) == [2, 4, 5, 5]
    assert all(c["status"] == "ok" for c in d["charts"])
    titles = {c["title"] for c in d["charts"]}
    assert titles == {"Reaction Rate vs Temperature Step", "Graduation Rate by Program", "Rainfall This Week", "Students Enrolled by Major"}


def test_chart_record_and_ask(client):
    d = wait(client, client.post("/api/samples/clean-line").json()["id"])
    cid = d["chart_ids"][0]
    c = client.get(f"/api/charts/{cid}").json()
    assert c["source"] == "fixture" and "not model output" in c["source_note"]
    assert c["confidence"]["level"] == "high" and c["summary"]["text"]
    assert client.get(f"/api/charts/{cid}/image").headers["content-type"] == "image/png"
    a = client.post(f"/api/charts/{cid}/ask", json={"question": "where is the maximum?"}).json()
    assert a["operation"] == "max" and "45 mol/s" in a["answer"] and a["chooser"] == "rules"
    assert d["charts"][0]["retryable"] is False
    r = client.post(f"/api/charts/{cid}/retry")
    assert r.status_code == 409 and "live mode" in r.json()["detail"]


def test_rejects_unsupported_type(client):
    r = client.post("/api/documents", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 415 and "PDF, PNG, JPG, or WEBP" in r.json()["detail"]


def test_rejects_too_large(client):
    big = b"%PDF-1.4\n" + b"0" * (20 * 1024 * 1024 + 10)
    r = client.post("/api/documents", files={"file": ("big.pdf", big, "application/pdf")})
    assert r.status_code == 413 and "20 MB" in r.json()["detail"]


def test_rejects_too_many_pages(client):
    doc = pymupdf.open()
    for _ in range(41):
        doc.new_page()
    r = client.post("/api/documents", files={"file": ("long.pdf", doc.tobytes(), "application/pdf")})
    assert r.status_code == 413 and "41 pages" in r.json()["detail"]


def test_rejects_empty_and_broken(client):
    r = client.post("/api/documents", files={"file": ("e.png", b"", "image/png")})
    assert r.status_code == 422
    r = client.post("/api/documents", files={"file": ("b.png", b"\x89PNG\r\n\x1a\nnope", "image/png")})
    assert r.status_code == 422 and "could not be opened" in r.json()["detail"]


def test_unknown_image_in_fixture_mode_says_a_key_is_needed(client):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), "white").save(buf, "PNG")
    d = wait(client, client.post("/api/documents", files={"file": ("x.png", buf.getvalue(), "image/png")}).json()["id"])
    assert d["status"] == "failed" and "Gemini API key" in d["error"]


def test_delete_removes_files(client):
    d = wait(client, client.post("/api/samples/bars").json()["id"])
    cid = d["chart_ids"][0]
    assert client.delete(f"/api/documents/{d['id']}").json() == {"deleted": True}
    assert client.get(f"/api/documents/{d['id']}").status_code == 404
    assert client.get(f"/api/charts/{cid}").status_code == 404
    assert client.delete(f"/api/documents/{d['id']}").status_code == 404


def test_expired_documents_are_swept(client):
    from app import main
    d = wait(client, client.post("/api/samples/bars").json()["id"])
    doc = main.state.storage.get_document(d["id"])
    doc.created -= 61 * 60
    removed = main.state.storage.sweep()
    assert d["id"] in removed
    assert client.get(f"/api/documents/{d['id']}").status_code == 404


def test_events_stream_ends(client):
    doc_id = client.post("/api/samples/clean-line").json()["id"]
    with client.stream("GET", f"/api/documents/{doc_id}/events") as r:
        body = "".join(r.iter_text())
    assert "event: end" in body and '"status": "done"' in body


def test_rate_limit_refuses_plainly():
    from app.limits import Limits

    lim = Limits()
    lim.per_hour["document"] = 2
    assert lim.check("document", "1.2.3.4") is None and lim.check("document", "1.2.3.4") is None
    msg = lim.check("document", "1.2.3.4")
    assert msg and msg.startswith("Too many files") and "minutes" in msg
    assert lim.check("document", "5.6.7.8") is None  # another visitor is not affected
    lim.documents_per_day = 3
    assert lim.check("document", "9.9.9.9").startswith("This server has reached its daily limit")


def test_forwarded_for_uses_the_entry_the_proxy_added():
    from types import SimpleNamespace

    from app.limits import client_id

    req = SimpleNamespace(headers={"x-forwarded-for": "6.6.6.6, 203.0.113.9"}, client=None)
    assert client_id(req) == "203.0.113.9"
