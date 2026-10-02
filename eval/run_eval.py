"""Evaluate every test chart and write eval/results.md (and results.json).

For each chart in test_data/clean and test_data/hard it runs the normal
pipeline (live Gemini if credentials are configured, otherwise fixture mode),
then compares the extracted values with the answer key (eval/scoring.py):

- error: |extracted - true| as a percent of the axis range, where the axis
  range is the true data span plus 5% on each side; log axes in log10 space
- per point: was a real error (more than 3% off) flagged as uncertain, and was a
  correct point (within 1.5%) flagged anyway (a false alarm)
- per chart: the level, and whether the trust layer flagged the chart (medium or low)
- latency of the two Gemini readings and of the whole chart
- tilted photos: the error before and after straightening, and whether the
  straightened reading was adopted

It also runs the sample lecture PDF (4 charts on pages 2, 4 and 5 expected) and
asks questions through the HTTP API, recording which operation was chosen.

If Gemini stays busy (429 or 503) for --max-busy charts in a row, the run stops,
keeps what is cached, and the report lists what is missing. Rerunning only asks
for what is missing.

The answer keys are read only here, after the pipeline has finished. They are
never passed to the pipeline or the model.

Run: python eval/run_eval.py [--only NAME ...] [--max-busy 2] [--no-questions]
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval"))

from scoring import CORRECT_PCT, REAL_ERROR_PCT, load_truth, point_errors, summarize  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.fixtures_provider import FixtureProvider  # noqa: E402
from app.gemini import GeminiProvider, ReadingFailed, ResponseCache  # noqa: E402
from app.models import Document  # noqa: E402
from app.pipeline.extract import Unsupported  # noqa: E402
from app.pipeline.runner import Pipeline  # noqa: E402
from app.storage import Storage  # noqa: E402

MEASURED_FAILURES = {"hs1_sparse_ticks", "h05c_phone_photo"}  # SPEC section 6: must be flagged

# Questions asked through the API: (sample, question, operation a careful reader would expect).
QUESTIONS = [
    ("clean-line", "What is the highest reaction rate?", "max"),
    ("clean-line", "What is the rate at step 3?", "value_at"),
    ("clean-line", "At which step does the rate first go above 30 mol/s?", "x_where"),
    ("clean-line", "How fast does the rate climb between step 2 and step 5?", "slope"),
    ("two-lines", "Which program had the higher graduation rate in 2020?", "compare"),
    ("two-lines", "Do the two programs ever cross?", "crossings"),
    ("two-lines", "What is the average graduation rate of Program B?", "average"),
    ("bars", "Which day had the least rain?", "min"),
    ("bars", "What is the spread between the wettest and the driest day?", "range"),
    ("clean-line", "Describe the overall shape of this chart.", "describe"),
    ("bars", "How much rain will fall next Sunday?", "cannot_answer"),
    ("two-lines", "Who collected this data?", "cannot_answer"),
]


CACHE_ONLY = False  # --cache-only: replay saved live readings (eval/live_cache), no API calls


def provider_and_mode():
    s = load_settings()
    if CACHE_ONLY:
        from types import SimpleNamespace

        from google.genai import errors

        def no_call(*a, **k):
            raise errors.ClientError(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                                     "message": "cache-only run: not read live (per day)"}})

        gp = GeminiProvider(s, ResponseCache(s.cache_dir, [ROOT / "eval/live_cache"]))
        gp.client = SimpleNamespace(models=SimpleNamespace(generate_content=no_call, get=lambda model: None))
        return gp, "live", "Replayed from saved live readings (eval/live_cache); no new API calls.", s.backend_label
    if s.app_mode == "live":
        gp = GeminiProvider(s, ResponseCache(s.cache_dir, s.seed_cache_dirs))
        ok, note = gp.check()
        if ok:
            return gp, "live", note, s.backend_label
        return FixtureProvider(), "fixture", f"Gemini credentials did not work: {note}", ""
    return FixtureProvider(), "fixture", "No Gemini credentials are set.", ""


def run(only: list[str] | None = None, max_busy: int = 2, questions: bool = True) -> dict:
    provider, mode, note, backend = provider_and_mode()
    print(f"Mode: {mode} ({getattr(provider, 'model', '')}). {backend} {note}".strip(), flush=True)
    if mode == "live":
        print("If Gemini is overloaded, requests are retried with backoff, so some charts can take a minute.", flush=True)
    truth = load_truth()
    tmp = Path(tempfile.mkdtemp())
    store = Storage(tmp, 60)
    pipe = Pipeline(store, provider, mode)
    rows, busy_streak, stopped = [], 0, ""
    for name, (folder, t) in sorted(truth.items(), key=lambda kv: (kv[1][0] != "clean", kv[0])):
        if only and name not in only:
            continue
        row = {"name": name, "set": folder,
               "expected": "flag" if name in MEASURED_FAILURES else "no flag" if folder == "clean" else ""}
        if stopped:
            row.update({"status": "not run", "meets": None})
            rows.append(row)
            continue
        path = ROOT / "test_data" / folder / f"{name}.png"
        doc = Document(id=f"eval-{name}"[:40], filename=path.name, kind="image", is_sample=True, mode=mode)
        store.doc_dir(doc.id)
        t0 = time.time()
        pipe.process(doc, path.read_bytes())  # image bytes only; the answer key is not passed
        row["seconds"] = round(time.time() - t0, 1)
        chart = store.get_chart(doc.chart_ids[0]) if doc.chart_ids else None
        if chart is None or chart.status != "ok":
            err = chart.error if chart else doc.error
            busy = "Gemini is busy" in (err or "")
            row.update({"status": "busy" if busy else "failed", "error": err, "level": "n/a" if busy else "low",
                        "flagged": None if busy else True})
        else:
            pts, missing = point_errors(chart, t)
            row.update(summarize(pts, missing))
            row.update({
                "status": "ok", "level": chart.confidence.level, "flagged": chart.confidence.level != "high",
                "source": chart.source, "model": chart.model, "second_model": chart.timings.get("second_model", ""),
                "risks": [r.code for r in chart.confidence.risk_factors], "timings": chart.timings,
                "uncertain": sum(1 for s in chart.series for p in s.points if "uncertain" in p.flags),
                "tilted": any(r.code == "tilted" for r in chart.confidence.risk_factors) or bool(chart.straightened),
                "points_detail": pts,
            })
            if chart.straightened:
                row["straightening"] = straightening(provider, path, chart, t)
            if chart.confidence.signals.get("second_reading") == "busy":
                # Values were read but the cross-check was skipped because Gemini was busy: the level says
                # "unverified" rather than anything about the chart. Rerun to complete it.
                row["status"] = "partial"
        busy_streak = busy_streak + 1 if row["status"] in ("busy", "partial") else 0
        if mode == "live" and max_busy and busy_streak >= max_busy:
            stopped = (f"Gemini was busy (429 or 503) for {busy_streak} charts in a row, so the run stopped after "
                       f"{name}. Finished readings are cached; run the script again later to measure the rest.")
            print(stopped, flush=True)
        row["meets"] = None if row.get("flagged") is None or row["status"] == "partial" else (
            row["flagged"] if row["expected"] == "flag" else (not row["flagged"]) if row["expected"] == "no flag" else None)
        rows.append(row)
        errs = "" if row.get("avg_err") is None else f"avg {row['avg_err']:.2f}%  worst {row['worst_err']:.2f}%"
        print(f"{name:22s} {row['status']:7s} {str(row.get('level')):6s} {errs:30s} {row['seconds']}s", flush=True)

    pdf = None
    if not only and not stopped:
        doc = Document(id="eval-pdf", filename="sample_lecture.pdf", kind="pdf", is_sample=True, mode=mode)
        store.doc_dir(doc.id)
        t0 = time.time()
        pipe.process(doc, (ROOT / "test_data/pdf/sample_lecture.pdf").read_bytes())
        charts = [store.get_chart(c) for c in doc.chart_ids]
        pages = sorted(c.page for c in charts)
        truth_pdf = json.loads((ROOT / "test_data/pdf/truth_pdf.json").read_text())
        expected = sorted(p["page"] for p in truth_pdf["pages"] for _ in p["charts"])
        pdf = {"found": len(pages), "pages": pages, "expected_pages": expected, "ok": pages == expected,
               "titles": [c.title for c in charts], "levels": [c.confidence.level for c in charts],
               "statuses": [c.status for c in charts], "seconds": round(time.time() - t0, 1),
               "detect_step": next((s.detail for s in doc.steps if s.key == "detect"), "")}
        print(f"PDF: {pdf['found']} charts on pages {pdf['pages']} ({'pass' if pdf['ok'] else 'FAIL'})", flush=True)
    qa = run_questions(mode) if questions and not only and not stopped else []
    return {"mode": mode, "cache_only": CACHE_ONLY, "note": note, "backend": backend, "model": getattr(provider, "model", ""), "rows": rows,
            "pdf": pdf, "questions": qa, "stopped": stopped,
            "injected": run_injected() if not only else [], "when": time.strftime("%Y-%m-%d %H:%M")}


# ---------------------------------------------------------------------------
# Straightening: error of the reading of the photo and of the straightened copy
# ---------------------------------------------------------------------------


def _reading_errors(provider, im, truth):
    """Errors of the first reading of one image. In live mode this is a cache hit from the run above."""
    from app.models import Chart
    from app.pipeline.extract import normalize
    from app.pipeline.runner import ImageInput

    reading, meta = provider.read_values(ImageInput.from_image(im), "samples")
    kind, xa, ya, series, _ = normalize(reading)
    c = Chart(id="s", document_id="s", chart_type=kind, x_axis=xa, y_axis=ya, series=series)
    rows, missing = point_errors(c, truth)
    return summarize(rows, missing), meta.model


def straightening(provider, path, chart, truth) -> dict:
    from app.imaging import load_image
    from app.pipeline.straighten import straighten

    st = chart.straightened or {}
    out = {"adopted": bool(st.get("used")), "note": st.get("note", ""),
           "before_level": (st.get("before") or {}).get("level"), "after_level": (st.get("after") or {}).get("level"),
           "tilt_before": (st.get("before") or {}).get("tilt_deg"), "tilt_after": (st.get("after") or {}).get("tilt_deg"),
           "seconds": (st.get("after") or {}).get("seconds")}
    im = load_image(path.read_bytes())
    try:
        out["before"], _ = _reading_errors(provider, im, truth)
        res = straighten(im)
        # Only reuse a reading the pipeline already made (a cache hit); never ask Gemini again here.
        if res is not None and st.get("after"):
            out["after"], out["after_model"] = _reading_errors(provider, res[0], truth)
        elif res is not None:
            out["error"] = st.get("note", "The straightened copy was not read.")
    except (ReadingFailed, Unsupported) as e:
        out["error"] = ("Reading the straightened copy needs live mode." if "Fixture mode" in str(e) else str(e)[:160])
    return out


# ---------------------------------------------------------------------------
# Questions through the HTTP API
# ---------------------------------------------------------------------------


def run_questions(mode: str) -> list[dict]:
    import os

    from fastapi.testclient import TestClient

    os.environ.setdefault("FIXTURE_STEP_DELAY", "0")
    from app.main import app

    out = []
    with TestClient(app) as c:
        charts = {}
        for sample in sorted({q[0] for q in QUESTIONS}):
            doc_id = c.post(f"/api/samples/{sample}").json()["id"]
            for _ in range(600):
                d = c.get(f"/api/documents/{doc_id}").json()
                if d["status"] in ("done", "failed"):
                    break
                time.sleep(0.5)
            ok = [ch for ch in d.get("charts", []) if ch["status"] == "ok"]
            charts[sample] = ok[0]["id"] if ok else None
        for sample, q, expected in QUESTIONS:
            cid = charts.get(sample)
            if cid is None:
                out.append({"sample": sample, "question": q, "expected": expected, "error": "chart not read"})
                continue
            t0 = time.time()
            r = c.post(f"/api/charts/{cid}/ask", json={"question": q})
            a = r.json()
            out.append({"sample": sample, "question": q, "expected": expected, "operation": a.get("operation"),
                        "arguments": a.get("arguments"), "answer": a.get("answer"), "chooser": a.get("chooser"),
                        "chooser_note": a.get("chooser_note"), "answerable": a.get("answerable"),
                        "seconds": round(time.time() - t0, 2)})
            print(f"Q [{a.get('chooser')}] {q} -> {a.get('operation')}: {str(a.get('answer'))[:90]}", flush=True)
    return out


# ---------------------------------------------------------------------------
# Injected failures: the first reading is perturbed the way Gemini was measured
# to fail; the second reading and the image are untouched.
# ---------------------------------------------------------------------------


def _shift_near_peak(r):
    pts = r["series"][0]["points"]
    ys = [p["y"] for p in pts]
    for i in range(3, 9):
        pts[i]["y"] = ys[i - 1]


def _growing_error(r):
    for s in r["series"]:
        n = len(s["points"])
        for i, p in enumerate(s["points"]):
            p["y"] += 2.6 * i / (n - 1)
    r["series"][0]["points"][-1]["y"] = 72.4


def _local_bump(r):
    for i in (5, 6, 7):
        r["series"][0]["points"][i]["y"] += 4.0


def _wrong_bar(r):
    r["series"][0]["points"][2]["y"] = 3.5


INJECTED = [
    ("hs1_sparse_ticks", "Values shifted one step along x near the peak (the measured hs1 failure)", _shift_near_peak),
    ("05_line_two_series", "Error growing left to right, last value 72.4 above a 70 axis (the measured h05c pattern, on the flat chart)", _growing_error),
    ("02_line_peak", "Three points misread by about 10% of the axis", _local_bump),
    ("08_bar_decimal", "One bar misread (Wed 3.5 instead of 2.1)", _wrong_bar),
]


def run_injected() -> list[dict]:
    from PIL import Image

    from app.models import Chart, ChartReading, GeometryReading
    from app.pipeline import trust
    from app.pipeline.extract import normalize

    fx = {e["name"]: e for e in json.loads((ROOT / "app/fixtures/fixtures.json").read_text())["charts"]}
    truth = load_truth()
    out = []
    for name, label, mutate in INJECTED:
        e = fx[name]
        raw = copy.deepcopy(e["reading"])
        mutate(raw)
        reading = ChartReading.model_validate(raw)
        geometry = GeometryReading.model_validate(e["geometry"])
        im = Image.open(ROOT / e["file"]).convert("RGB")
        kind, xa, ya, series, notes = normalize(reading)
        chart = Chart(id="x", document_id="x", chart_type=kind, x_axis=xa, y_axis=ya, series=series,
                      has_markers=reading.has_point_markers, image_size=list(im.size))
        trust.assess(chart, reading, geometry, im, notes)
        pts, missing = point_errors(chart, truth[name][1])
        sm = summarize(pts, missing)
        out.append({"name": name, "label": label, "avg_err": sm["avg_err"], "worst_err": sm["worst_err"],
                    "level": chart.confidence.level, "caught": sm["caught"], "real_errors": sm["real_errors"],
                    "false_alarms": sm["false_alarms"],
                    "regions": [r.text for r in chart.confidence.uncertain_regions]})
    return out


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def pct(v):
    return "n/a" if v is None else f"{v:.2f}%"


def secs(v):
    return "n/a" if v is None else f"{v:.1f}"


def counts(rows: list[dict]) -> dict:
    keys = ("matched", "real_errors", "caught", "missed", "correct", "false_alarms", "caught_marked", "false_marked")
    return {k: sum(r.get(k, 0) for r in rows) for k in keys}


def write_md(res: dict, out: Path) -> None:
    rows = res["rows"]
    measured = [r for r in rows if r["status"] in ("ok", "partial")]
    L = ["# Evaluation results", ""]
    mode = "live readings, replayed from the saved cache" if res.get("cache_only") else res["mode"]
    L.append(f"Run {res['when']}. Mode: **{mode}**. {res.get('backend', '')} {res['note']}".rstrip())
    L.append("")
    if res["mode"] == "fixture":
        L += [
            "> **This run did not call Gemini.** In fixture mode the values come from the answer keys, so the "
            "error columns are zero by construction and are not a measurement of the model, and there are no real "
            "errors to catch. What this run does measure is the trust layer: which charts and points it flags from the "
            "image itself (tilt, blur, resolution), from the chart's structure (markers, tick labels), and from the "
            "pixel and cross-checks against the drawn image. Run `python eval/run_eval.py` with Gemini credentials to "
            "measure the model.",
            "",
        ]
    else:
        cached = [r["name"] for r in measured if r.get("source") == "cache"]
        if cached:
            L += [f"> {len(cached)} of {len(measured)} charts came from the response cache (saved live output from an "
                  "earlier run, same prompts and model); their latency is the time measured when they were read.", ""]
    if res.get("stopped"):
        L += [f"> **The run stopped early.** {res['stopped']}", ""]
    for status, text in (("busy", "not measured because Gemini was busy"), ("not run", "not run because the run stopped"),
                         ("failed", "could not be read")):
        names = [r["name"] for r in rows if r["status"] == status]
        if names:
            L += [f"> **{len(names)} chart{'s' if len(names) > 1 else ''} {text}:** {', '.join(names)}.", ""]
    partial = [r["name"] for r in rows if r["status"] == "partial"]
    if partial:
        L += [f"> **{len(partial)} chart{'s were' if len(partial) > 1 else ' was'} only partly checked** because Gemini was busy "
              f"during the second reading: {', '.join(partial)}. Their errors are real measurements, but their level is not "
              "counted toward the targets.", ""]

    # Headline counts
    flat = [r for r in measured if not r.get("tilted")]
    c_all, c_flat = counts(measured), counts(flat)
    req = [r for r in rows if r["expected"] and r.get("meets") is not None]
    met = sum(1 for r in req if r["meets"])
    L += ["## Summary", ""]
    L.append(f"- **Charts measured: {len(measured)} of {len(rows)}**, {c_all['matched']} points.")
    if measured:
        avg = [r["avg_err"] for r in measured if r.get("avg_err") is not None]
        L.append(f"- **Average error over all measured charts: {pct(sum(avg) / len(avg) if avg else None)}** "
                 f"(mean of per-chart averages); worst single point {pct(max((r['worst_err'] or 0) for r in measured))}.")
    L.append(f"- **Real errors caught: {c_all['caught']} of {c_all['real_errors']}** (points more than {REAL_ERROR_PCT:g}% "
             f"of the axis off that were announced as uncertain). Marked medium or uncertain in the verification view: "
             f"{c_all['caught_marked']} of {c_all['real_errors']}.")
    L.append(f"- **False alarms: {c_all['false_alarms']} of {c_all['correct']}** correct points (within {CORRECT_PCT:g}%) "
             f"were announced as uncertain; {c_flat['false_alarms']} of {c_flat['correct']} on charts that are not tilted "
             "photos (every point of a tilted photo is uncertain until it is straightened).")
    levels = {lvl: sum(1 for r in measured if r.get("level") == lvl) for lvl in ("high", "medium", "low")}
    L.append(f"- **Chart levels:** {levels['high']} high, {levels['medium']} medium, {levels['low']} low. "
             f"Trust-layer targets met: {met} of {len(req)} (clean charts not flagged; `hs1_sparse_ticks` and "
             "`h05c_phone_photo` flagged, meaning medium or low).")
    st_all = [r["straightening"] for r in measured if r.get("straightening")]
    if st_all:
        befores = [x["before"]["avg_err"] for x in st_all if x.get("before") and x["before"].get("avg_err") is not None]
        afters = [x["after"]["avg_err"] for x in st_all if x.get("after") and x["after"].get("avg_err") is not None]
        L.append(f"- **Tilted photos:** straightened and read again on {len(st_all)}, adopted on "
                 f"{sum(1 for x in st_all if x['adopted'])}. Average error of the photo's reading "
                 f"{pct(min(befores)) if befores else 'n/a'} to {pct(max(befores)) if befores else 'n/a'}; "
                 f"of the straightened copy {pct(min(afters)) if afters else 'n/a'} to {pct(max(afters)) if afters else 'n/a'} "
                 "(the table below scores the reading the app kept).")
    if res["pdf"]:
        p = res["pdf"]
        unread = sum(1 for st in p.get("statuses", []) if st != "ok")
        how = (f"{unread} of {p['found']} charts were not read (no live reading saved), so the charts were found from "
               "the PDF's own image placements" if unread else f"levels {', '.join(p['levels'])}")
        L.append(f"- **Sample PDF: {p['found']} charts on pages {', '.join(map(str, p['pages']))}** "
                 f"(expected 4 on pages 2, 4, 5, 5): {'pass' if p['ok'] else 'FAIL'}; {how}; {p['seconds']} s end to end.")
    L.append("")

    L += ["## Accuracy and trust layer", "",
          "| Chart | Set | Model (first / second reading) | Avg error | Worst error | Missed | Level | Real errors caught | "
          "False alarms | Target | Risk factors |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        target = {"flag": "flag", "no flag": "no flag", "": "none"}[r["expected"]]
        ok = "" if r.get("meets") is None else (" (met)" if r["meets"] else " (**missed**)")
        if r["status"] in ("busy", "not run"):
            L.append(f"| `{r['name']}` | {r['set']} | | n/a | n/a | n/a | {r['status']} | n/a | n/a | {target} | |")
            continue
        if r["status"] == "failed":
            L.append(f"| `{r['name']}` | {r['set']} | | n/a | n/a | n/a | could not read | n/a | n/a | {target}{ok} | {r.get('error', '')} |")
            continue
        model = r.get("model", "")
        if r.get("second_model") and r["second_model"] != model:
            model += f" / {r['second_model']}"
        L.append(f"| `{r['name']}` | {r['set']} | {model} | {pct(r['avg_err'])} | {pct(r['worst_err'])} | {r['missing']} | "
                 f"{r['level']}{' (partial)' if r['status'] == 'partial' else ''} | {r['caught']} of {r['real_errors']} | "
                 f"{r['false_alarms']} of {r['correct']} | {target}{ok} | {', '.join(r.get('risks', [])) or 'none'} |")
    L += ["", f"Error is the absolute difference between extracted and true value, as a percent of the axis range (the "
          "true data span plus 5% each side; log axes in log10 space). Missed: true points with no extracted point near "
          f"their x position. A real error is more than {REAL_ERROR_PCT:g}% off; a false alarm is a point within "
          f"{CORRECT_PCT:g}% that was announced as uncertain.", ""]

    timed = [r for r in measured if r.get("timings")] if res["mode"] == "live" else []
    if timed:
        L += ["## Latency", "",
              "Seconds per chart. The two readings run in parallel; each call's time includes the SDK's backoff when "
              "Gemini was busy. \"Total\" is the whole chart: readings, checks, straightening of a tilted photo, summary.", "",
              "| Chart | First reading | Second reading | Both readings (wall) | Total | Source |", "|---|---|---|---|---|---|"]
        for r in timed:
            t = r["timings"]
            L.append(f"| `{r['name']}` | {secs(t.get('read_s'))} | {secs(t.get('second_s'))} | {secs(t.get('readings_wall_s'))} | "
                     f"{secs(t.get('total_s'))} | {t.get('read_source', '')} |")
        live = [r["timings"] for r in timed if r["timings"].get("read_source") == "live"]
        for label, key in (("first reading", "read_s"), ("second reading", "second_s"), ("total", "total_s")):
            vals = sorted(v for v in (t.get(key) for t in live) if v)
            if vals:
                L.append(f"\n{label.capitalize()} (live calls only): median {vals[len(vals) // 2]:.1f} s, "
                         f"max {vals[-1]:.1f} s over {len(vals)} charts.")
        L.append("")

    st_rows = [r for r in measured if r.get("straightening")]
    if st_rows:
        L += ["## Tilted photos and straightening", "",
              "Error of the first reading of the photo and of the straightened copy, against the answer key. "
              "The straightened reading is adopted only if its confidence is higher.", "",
              "| Photo | Tilt before / after | Before: avg, worst | After: avg, worst | Level before / after | Adopted | Note |",
              "|---|---|---|---|---|---|---|"]
        for r in st_rows:
            s = r["straightening"]
            b, a = s.get("before") or {}, s.get("after") or {}
            tilt = f"{s['tilt_before'] or 0:.1f} / {s['tilt_after']:.1f}" if s.get("tilt_after") is not None else f"{s.get('tilt_before') or 0:.1f} / n/a"
            L.append(f"| `{r['name']}` | {tilt} | {pct(b.get('avg_err'))}, {pct(b.get('worst_err'))} | "
                     f"{pct(a.get('avg_err'))}, {pct(a.get('worst_err'))} | {s.get('before_level')} / {s.get('after_level') or 'n/a'} | "
                     f"{'yes' if s['adopted'] else 'no'} | {s.get('error') or s.get('note', '')} |")
        L.append("")

    if res.get("questions"):
        L += ["## Questions through the API", "",
              "Asked with `POST /api/charts/{id}/ask` on the built-in samples. The chooser is who picked the calculation: "
              "`gemini` (function calling) or `rules` (fixture mode, or Gemini unavailable). Code computes every number.", "",
              "| Sample | Question | Expected | Chosen | Chooser | Answer |", "|---|---|---|---|---|---|"]
        for q in res["questions"]:
            ans = (q.get("answer") or q.get("error") or "").replace("|", "/")
            L.append(f"| {q['sample']} | {q['question']} | `{q['expected']}` | `{q.get('operation')}` | {q.get('chooser', '')} | {ans} |")
        good = sum(1 for q in res["questions"] if q.get("operation") == q["expected"])
        L += ["", f"{good} of {len(res['questions'])} questions got the expected operation.", ""]

    if res.get("injected"):
        L += ["## Injected failures (simulated, not model output)", "",
              "The first reading is perturbed the way Gemini was measured to fail. The second reading and the image are "
              "untouched, so the cross-check and the pixel check have to find the wrong values on their own. "
              "These cases also run as tests in `tests/test_trust.py`.", "",
              "| Chart | What was injected | Avg error | Worst error | Real errors caught | False alarms | Level | Uncertain regions |",
              "|---|---|---|---|---|---|---|---|"]
        for r in res["injected"]:
            L.append(f"| `{r['name']}` | {r['label']} | {pct(r['avg_err'])} | {pct(r['worst_err'])} | "
                     f"{r['caught']} of {r['real_errors']} | {r['false_alarms']} | {r['level']} | {'; '.join(r['regions']) or 'none'} |")
        L.append("")
    out.write_text("\n".join(L))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--max-busy", type=int, default=2, help="stop after this many busy charts in a row (0: never)")
    ap.add_argument("--no-questions", action="store_true")
    ap.add_argument("--cache-only", action="store_true",
                    help="rebuild the report from the saved live readings in eval/live_cache, without API calls")
    a = ap.parse_args()
    global CACHE_ONLY
    CACHE_ONLY = a.cache_only
    if CACHE_ONLY:
        a.max_busy = 0  # a reading that is not saved is reported as not measured; keep going
        a.no_questions = True  # questions go through the app, which would call Gemini
    res = run(a.only, a.max_busy, not a.no_questions)
    out = ROOT / "eval"
    slim = copy.deepcopy(res)
    for r in slim["rows"]:
        r.pop("points_detail", None)
    (out / "results.json").write_text(json.dumps(slim, indent=1, default=str))
    (out / "points.json").write_text(json.dumps({r["name"]: r.get("points_detail") for r in res["rows"]}, default=str))
    write_md(res, out / "results.md")
    print(f"wrote {out / 'results.md'}")


if __name__ == "__main__":
    main()
