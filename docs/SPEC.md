# Hear the Graph: Project Documentation

Working title. This is the product and technical specification. Save it in the repo as `docs/SPEC.md`.

## 1. What it is

Hear the Graph is a website that lets blind and low-vision STEM students hear and explore the charts in their lecture slides. A student uploads a lecture PDF or an image. The app finds every chart, turns each one into data, and lets the student listen to its shape, step through exact values, and ask questions. It also checks its own work and says when the numbers cannot be trusted.

One-line pitch: AI that lets a blind student hear a graph, and tells them when not to trust it.

## 2. Who it is for

- **Primary user:** a blind or low-vision student in a STEM course who receives slides, PDFs, and handouts full of charts.
- **Secondary users:** a sighted helper, TA, or disability resource center staff member who wants to check or prepare materials; faculty who want to convert slides before class.

What they have today: screen readers can give an AI description of an image (VoiceOver, JAWS Picture Smart AI, Be My AI). Those tools describe. They do not let the student explore exact values, and the student has no way to know when the description is wrong.

## 3. What it does

| Feature | What the user gets |
|---|---|
| Upload | Drop in a PDF or image (PNG, JPG, WEBP). Up to 20 MB and 40 pages. |
| Chart detection | Every chart on every page is found and listed, for example "Page 4, line chart: Graduation Rate by Program". |
| Sound sweep | The chart plays left to right. Higher value means higher pitch. Sound pans from the left ear to the right as x increases. |
| Point-by-point exploration | Arrow keys move through the points. Each value is spoken. Jump to the maximum, minimum, start, and end. Switch between series. |
| Summary | A short spoken summary computed from the data: type, range, trend, maximum, minimum. |
| Questions | Ask in plain language, for example "where is the maximum?" or "what is the value at 2021?". Answers are computed from the data. |
| Confidence | Each chart gets a level (high, medium, low), the reasons, and which regions are uncertain. |
| Verification view | The original image with the extracted points drawn on top, marked by confidence, beside a data table. For helpers and judges. |
| Samples | Built-in sample files so anyone can try it without uploading. |
| Eyes-closed mode | Blanks the screen and plays the chart, for sighted people to experience it by ear. |

Supported charts: line charts and bar charts, single or multiple series, linear or log axes. Scatter plots are a stretch goal.

## 4. Screens

1. **Home.** A playable chart is the first thing on the page, so a visitor can hear a graph before reading anything. Below it: upload area and sample files.
2. **Processing.** The pipeline steps appear as they run (finding charts, reading values, cross-checking, verifying). Progress is also announced to screen readers.
3. **Document.** The list of charts found, each with page number, type, title, and confidence level.
4. **Chart.** The main screen. The chart image with a moving playhead, a transport bar (play, pause, speed), summary, question box, confidence panel, and data table. A toggle switches between the listening layout and the verification view.

## 5. How it works

```
Upload (PDF or image)
  -> Render pages to images            (PyMuPDF)
  -> Find charts on each page          (Gemini, bounding boxes) -> crop
  -> Read the chart                    (Gemini, structured output)
  -> Read it again a different way     (Gemini pixel positions + code converts pixels to values)
  -> Verify                            (sanity checks, cross-check, pixel check, risk factors)
  -> Confidence per point and chart
  -> Summary and question operations   (computed in code)
  -> Sound, keyboard exploration, overlay in the browser
```

Gemini does three jobs: finding charts, reading them, and choosing which calculation answers a question. Every number the student hears comes from extracted data and code, never from free-form model text.

## 6. Trust layer

This is the core contribution. Four signals are combined:

| Signal | What it checks |
|---|---|
| Sanity | Values inside the axis range, x values in order, a plausible number of points, valid structure. |
| Cross-check | A second reading by a different method: Gemini gives the plot area, axis ranges, and pixel positions of the points, and code converts pixels to values. Points where the two readings disagree lose confidence. |
| Pixel check | Each extracted point is mapped onto the image. If the line or bar is not actually there, the point loses confidence. |
| Risk factors | No point markers, fewer than four tick labels on an axis, a tilted photo, very low resolution. |

Output: a confidence value from 0 to 1 for each point, a level for the chart, reasons in plain language, and uncertain regions such as "values between x = 6 and x = 9".

How they combine: a point's confidence comes only from the checks on that point, and a point is uncertain only when one of them fails. Structural risks (no markers, few tick labels, low resolution, blur, a missing second reading) can lower a chart to medium, never to low and never a single point. When the two readings disagree but the image confirms the first reading, the first reading keeps full confidence. A tilted photo is the exception: every point is uncertain and the chart is low until the photo is straightened and read again. The second reading's tick positions are snapped to the tick marks and gridlines drawn in the image before the axes are fitted.

What the student hears:

| Level | Message |
|---|---|
| High | "High confidence." |
| Medium | "The shape is reliable. Exact values may be off by a few percent." |
| Medium, with uncertain points | "Most values passed the checks, but some are uncertain. Do not rely on the uncertain values." |
| Low | "Shape only. Do not rely on exact values. Ask a helper or upload the original file." |

Uncertain points are also announced as uncertain during exploration.

Measured behavior this is designed around (Gemini Flash, direct reading, error as a percent of axis range):

| Case | Average | Worst |
|---|---|---|
| Clean charts, blur, low resolution, log scale, overlapping lines, hand-drawn style | under 0.5% | under 0.5% |
| No markers and sparse tick labels (`hs1_sparse_ticks`) | 3.5% | 23.6% |
| Tilted phone photo (`h05c_phone_photo`) | 5.2% | 12.6% |

In both failures the overall shape was still correct. Stretch goal: detect a tilted photo, straighten it, and read it again.

## 7. Architecture and tools

One web service serves both the API and the website.

| Part | Tool |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic |
| AI | Gemini through the `google-genai` SDK: image understanding, structured output, function calling |
| PDF and images | PyMuPDF, Pillow, NumPy, OpenCV (headless) |
| Frontend | HTML, CSS, and JavaScript modules served as static files. No build step. |
| Sound and keyboard navigation | Chart2Music, plus the Web Audio API where more control is needed |
| Speech | ARIA live regions for screen readers. Optional built-in voice through the Web Speech API, off by default. |
| Storage | Temporary session folder on local disk, behind a small interface |
| Tests | pytest for logic, Playwright for end-to-end checks |
| Packaging | Dockerfile, single container |

Fonts and the Chart2Music script are stored in the repo, so the demo works without internet access apart from the Gemini calls.

## 8. API

| Method and path | Purpose |
|---|---|
| `POST /api/documents` | Upload a file. Returns a document id and starts processing. |
| `GET /api/samples` | List the built-in samples. |
| `POST /api/samples/{name}` | Start processing a built-in sample. |
| `GET /api/documents/{id}` | Status, pipeline steps, and the list of charts. |
| `GET /api/documents/{id}/events` | Live progress stream. |
| `GET /api/charts/{id}` | Full chart record: data, confidence, summary. |
| `GET /api/charts/{id}/image` | The cropped chart image. `?variant=straightened` or `?variant=photo` returns the straightened copy or the original photo of a tilted photo. |
| `POST /api/charts/{id}/ask` | Ask a question. Returns the answer, the operation used, the values, and the confidence. |
| `DELETE /api/documents/{id}` | Delete a document and its files now. |
| `GET /api/health` | Health check, reports the mode, the backend (API key or Google Cloud) and the model. |
| `POST /api/charts/{id}/retry` | Read a chart again after Gemini was busy. |

## 9. Data model

**Document:** id, filename, status, pages, steps, chart ids, created time.

**Chart:** id, document id, page, bounding box, image path, chart type, title, x axis (label, unit, min, max, scale, tick count, categories), y axis (same), series, confidence level, reasons, uncertain regions, risk factors, summary, plot area in pixels, source (`live`, `cache` or `fixture`) with a note, model used, and straightening result for tilted photos.

**Series:** name, points.

**Point:** x, x label, y, pixel position, confidence (0 to 1), flags (for example `crosscheck_disagree`, `pixel_off`, `out_of_range`, `uncertain`), and the raw check results (second-reading value, distance from the drawn line).

## 10. Question operations

Questions are answered by a fixed set of calculations. Gemini only picks the operation and its arguments.

`max`, `min`, `value_at(x)`, `x_where(y)`, `trend(from, to)`, `slope(from, to)`, `average`, `range`, `compare(series_a, series_b, x)`, `crossings(series_a, series_b)`, `describe`.

If a question cannot be answered from the data, the app says so. Every answer carries the confidence of the points it used.

## 11. Accessibility

The app must be usable from start to finish without sight or a mouse.

- Semantic HTML, correct headings and landmarks, labels on every control, a skip link
- Everything works by keyboard, with visible focus
- Spoken output goes through ARIA live regions, so screen readers such as VoiceOver, NVDA, and JAWS can read it (to be confirmed with screen reader users)
- Single-key shortcuts only apply while the chart has focus, so they do not clash with screen reader navigation keys
- Contrast meets WCAG AA, text can be enlarged, and nothing depends on color alone (confidence uses shape and text as well)
- Reduced-motion setting is respected

## 12. Design

Modern, calm, high-contrast, and specific to the subject. Signature element: the playhead that sweeps across the chart in sync with the sound. Typeface: Atkinson Hyperlegible, made by the Braille Institute for low-vision readers. Light and dark themes. Works on phones and laptops.

## 13. Testing and evaluation

- `test_data/clean`: 10 charts with exact data. `test_data/hard`: 17 harder charts with exact data. `test_data/pdf`: a 6-page sample lecture with 4 charts on pages 2, 4, and 5.
- The eval script runs every chart and reports average and worst error, confidence level, and whether the trust layer flagged it. Results go to `eval/results.md`.
- Targets: clean charts rated high; the two known failure cases flagged; the sample PDF yields exactly 4 charts.
- The answer keys are never sent to the model.

## 14. Privacy and responsible AI

- No accounts. Files stay in a temporary session folder and are deleted after 60 minutes or on request.
- Overtrust is the main risk for a user who cannot check the image. The trust layer, the plain-language warnings, and computed answers address it.
- Course materials are processed for personal accessibility use and are not shared.
- Limits are stated in the app: it works best on digital charts, and photos or charts with few labels get lower confidence.

## 15. Modes and configuration

| Variable | Meaning | Default |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API key (Gemini Developer API) | none |
| `GOOGLE_GENAI_USE_ENTERPRISE` | `true` uses Gemini on Google Cloud (Vertex AI) with Application Default Credentials instead of a key, and wins over `GEMINI_API_KEY`. The legacy name `GOOGLE_GENAI_USE_VERTEXAI` is also read. | `false` |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project for the cloud backend (required for it) | none |
| `GOOGLE_CLOUD_LOCATION` | Location for the cloud backend | `global` |
| `GEMINI_MODEL` | Model id | `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Comma-separated models tried in order when `GEMINI_MODEL` is not found, overloaded (503) or over quota (429); each chart records which model read it. `python tools/list_models.py --ping` shows which models a key can use right now | `gemini-flash-latest,gemini-flash-lite-latest` |
| `APP_MODE` | `live` calls Gemini. `fixture` serves answer-key data for the test charts with a visible banner. | `live` if a key or the cloud variables are set |
| `SESSION_TTL_MINUTES` | How long files are kept | 60 |
| `DATA_DIR` | Where session files go | `./.data` |
| `PORT` | Port the server listens on (Docker) | `8080` in the container, `8000` locally |
| `FIXTURE_STEP_DELAY` | Fixture mode only: pause after each pipeline step so the progress view is visible in a demo | `0.4` |
| `GEMINI_MAX_CONCURRENCY` | Parallel Gemini requests | `4` |
| `LIMIT_DOCUMENTS_PER_HOUR`, `LIMIT_QUESTIONS_PER_HOUR`, `LIMIT_RETRIES_PER_HOUR`, `LIMIT_DOCUMENTS_PER_DAY` | Request limits per visitor per hour, and new files per day for the server; 0 turns a limit off | 20, 120, 30, 500 |
| `DETECT_IN_IMAGES` | `1` asks Gemini for chart boxes in a single uploaded image too; by default an image is read whole, saving one request | `0` |

Gemini responses are cached on disk by image hash, task, model and prompt version. Cached results are labeled as saved output, never as a new reading. If a key is set but rejected at startup, the app falls back to fixture mode and says why. A chart that Gemini was too busy to read (or whose second reading was skipped) gets a "Try again" button, `POST /api/charts/{id}/retry`, which reads it again from its saved crop; readings that already succeeded come from the cache.

## 16. Repo layout

```
app/            FastAPI app, API routes, models, storage, Gemini client
app/pipeline/   detect, extract, crosscheck, verify, confidence, summary, qa
web/            index.html, css, js, fonts, vendor (Chart2Music), samples
eval/           eval script and results
tests/          pytest and Playwright tests
test_data/      test charts, sample PDF, answer keys
docs/SPEC.md    this document
DECISIONS.md    choices made during the build
Dockerfile, requirements.txt, .env.example, README.md
```

## 17. Out of scope for now

- Cloud Storage and Firestore. State is in memory and on local disk, so a Cloud Run deployment runs one instance (see the README). Gemini on Google Cloud credentials and a Cloud Run deploy command are supported.
- PowerPoint files (export to PDF first)
- Diagrams such as flowcharts, circuits, and molecules
- Camera capture with audio framing guidance
- Braille display output, Canvas integration, user accounts
