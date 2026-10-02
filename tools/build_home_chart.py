"""Precompute the playable chart on the home page from the fixture pipeline.

The home page must play a graph before anything is uploaded or any API is
called. This runs the normal pipeline in fixture mode on the reaction-rate
sample and saves the chart record as web/samples/home-chart.json. The page
labels it as known data, not a live reading.

Run: python tools/build_home_chart.py
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.fixtures_provider import FixtureProvider  # noqa: E402
from app.models import Document  # noqa: E402
from app.pipeline.runner import Pipeline  # noqa: E402
from app.storage import Storage  # noqa: E402


def main():
    with tempfile.TemporaryDirectory() as tmp:
        storage = Storage(Path(tmp), 60)
        pipe = Pipeline(storage, FixtureProvider(), "fixture")
        doc = Document(id="home", filename="reaction_rate.png", kind="image", is_sample=True)
        storage.doc_dir(doc.id)
        pipe.process(doc, (ROOT / "web/samples/reaction_rate.png").read_bytes())
        chart = storage.get_chart(doc.chart_ids[0])
        data = chart.model_dump()
        data["source_note"] = "Known values for this example chart, not a live reading."
        out = ROOT / "web/samples/home-chart.json"
        out.write_text(json.dumps(data, indent=1))
        print(f"wrote {out}: {chart.title}, {chart.confidence.level}")


if __name__ == "__main__":
    main()
