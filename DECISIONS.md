# Decisions

Choices made during the build, with the reason. Newest sections at the bottom of each part.

## Design plan

Written before any CSS, then checked against the brief.

**Principles**
1. The graph comes first. The home page opens on a chart you can play, with one line of text above it.
2. One loud thing per screen: the yellow playhead. Everything else is ink on paper: flat surfaces, hairline rules, no shadows, no gradients.
3. It is an audio player for a graph. Large chart, transport bar under it, then summary, questions, confidence.
4. Trust is never color alone. Every confidence level has a shape, a word, and a color.
5. Motion only where it means something: the playhead and pipeline progress. Under reduced motion, the playhead jumps from point to point instead of gliding, and the progress indicator stops spinning.
6. Plain sentence-case copy. Buttons name the action ("Play graph", "Read summary"). Errors say what happened and what to do next.

**Palette** (accessibility-signage: deep indigo ink and a strong yellow)

| Role | Light | Dark |
|---|---|---|
| Page background ("Paper" / "Night") | `#F6F7FB` | `#0D0F2B` |
| Surface (stage, inputs) | `#FFFFFF` | `#161A3F` |
| Ink, main text and primary buttons ("Deep indigo") | `#1A1D4E` | `#EEF0FF` |
| Soft ink, secondary text | `#474B7A` | `#B8BCE8` |
| Rule, borders | `#C9CCE0` | `#343A72` |
| Signal yellow, playhead and focus | `#FFC72C` | `#FFD54A` |
| High confidence, filled circle | `#136F45` | `#5BD69A` |
| Medium confidence, triangle | `#8A5300` | `#F5B94A` |
| Low confidence, hollow diamond | `#B42318` | `#FF8A7A` |

Yellow is never used for text. On light backgrounds it always sits inside an indigo outline (playhead edges, focus ring outer line) so it keeps 3:1 contrast against white. Chart images stay on a white "light table" in dark mode, because inverting them would change the colors the verification relies on.

**Type**: Atkinson Hyperlegible Next (self-hosted woff2, weights 400, 500, 700), falling back to Atkinson Hyperlegible, then system sans. Base size 19px, line height 1.55, scale 1.25: body 1.1875rem, h3 1.35rem, h2 1.75rem, h1 2.4rem (2rem on phones). Numbers in tables and the readout use tabular figures.

**Layout sketch**

```
Header:  [glyph] Hear the Graph              Shortcuts  Voice: off  Theme
Home:    h1 "Hear a graph"  (one sentence)
         [ chart image with yellow playhead ]
         [ Play graph | speed | series ]  readout: "Step 7: 45 mol/s"
         Open your own file (drop area + Choose a file, limits)
         Or try a sample (plain list of rows)
         What this does and when not to trust it
Document: filename, pipeline steps (live), list of charts with page, type, title, confidence
Chart:   back link, title, meta line (page, type, source), confidence line
         [ large chart stage + playhead ]  Listen | Verify toggle
         [ transport bar ]
         Summary | Questions          Confidence (reasons, uncertain regions)
         Data table
```

**Checked against the brief**: no identical rounded cards with soft shadows (sections are separated by rules and headings), no decorative gradients, no all-caps eyebrow labels, no cream and terracotta, no near-black with neon (the dark theme is deep indigo with yellow), no arrows on buttons, no entrance animations. Light and dark follow the system setting, with a toggle.

## Product and scope

- **Fixture mode runs the real pipeline.** Fixture data is two "readings" per test chart in exactly the shape Gemini returns, so cross-check, pixel check, confidence, summary, sound and questions all run the same code as live mode. Values come from the answer keys; titles, axis labels, tick labels, colors and marker facts were transcribed by hand from the images (`tools/build_fixtures.py`, `ANNOTATIONS`); pixel positions were measured by that script by aligning the answer-key values to the drawn ink. Every fixture chart carries `source: fixture` and the UI shows a banner. The fixture file is never sent to the model.
- **Fixture lookup is by image content, not by filename.** An upload matches a fixture by exact pixel hash, or by a thumbnail fingerprint (cosine similarity at least 0.95, same aspect ratio) for PDF crops. Any other file in fixture mode gets a plain message that a Gemini key is needed.
- **Built-in samples are copies of test files** in `web/samples` under readable names, so the answer keys stay in `test_data` and never ship with the website.
- **Home page chart** is precomputed from the fixture pipeline (`tools/build_home_chart.py`) and labeled as known data, so a visitor can play a graph before anything is uploaded or any API is called.

## Gemini

- **Docs could not be fetched.** `ai.google.dev` is blocked by this environment's network policy. SDK usage was taken from the installed `google-genai` 2.26 source and its README on GitHub: `client.models.generate_content`, `types.Part.from_bytes`, `response_mime_type="application/json"` with `response_json_schema`, `types.FunctionDeclaration(parameters_json_schema=...)`, `ToolConfig(FunctionCallingConfig(mode="ANY"))`, `AutomaticFunctionCallingConfig(disable=True)`.
- **Model id.** `gemini-3.8-flash` is the default as specified, but it could not be verified without a key. If the API answers 404 for it, the client switches to `GEMINI_FALLBACK_MODEL` (default `gemini-flash-latest`, the alias used throughout the SDK README) and the UI says which model was used.
- **Temperature and thinking settings are left at their defaults.** Without access to current docs, overriding them risked worse output on Gemini 3 models.
- **Coordinates use Gemini's native convention**: `[y, x]` and `[ymin, xmin, ymax, xmax]` normalized to 0-1000.
- **No JSON examples in prompts.** The schema defines the shape; the SDK README warns that duplicating it lowers quality.
- **Retry once, then fail plainly.** Empty, unparsable, schema-invalid, or semantically invalid output (no series, fewer than 2 points, bad boxes) triggers one retry with a short correction note. A second failure marks the chart as "could not be read".
- **Startup key check.** In live mode the server calls `models.get` once. If the key is rejected, it switches to fixture mode with a banner that says why.
- **Cache** is keyed by pixel hash of the image, task, model and `PROMPT_VERSION`. Samples are cached in `cache/samples` and kept. Uploads are cached in `cache/uploads`; those entries are deleted with their document and expire with the session TTL. Cached results are labeled "Saved model output from (time), not a new reading."

## Pipeline

- **Text-only PDF pages are skipped** in live mode (no embedded images and fewer than 10 vector drawing paths) to save calls and avoid false detections.
- **Detection fallback.** If the detector fails, or in fixture mode, PDF charts are taken from the page's embedded image placements (exact for slide decks with chart images), and an uploaded image is used whole.
- **A single uploaded image with one detected chart covering at least 60% of it is used whole**, so the crop never cuts off tick labels.

## Sound and exploration

- **Two audio paths, one pitch table.** Chart2Music handles point-by-point exploration and speech (arrow keys, Home/End, `[`/`]` for min/max, Page Up/Down for series). The whole-graph sweep is scheduled by our own Web Audio code so the playhead can be driven from the audio clock. Both use the same semitone table (G3 to C6), passed to Chart2Music as `hertzes`, so a point sounds the same either way.
- **Line sweeps glide, bar sweeps step.** A line plays as one continuous tone that glides between points, with a soft pluck on each data point so they can be counted. Bars play as separate notes, and the playhead steps from bar to bar to match.
- **Uncertainty cue.** Uncertain points get a short band-passed hiss layered on the note, both in the sweep and when stepping with arrow keys (through a custom Chart2Music `audioEngine`). Chart2Music also speaks "uncertain" after the value, using its point `label` field (simple points do not go through its translation hook).
- **Spoken point format** follows Chart2Music's convention "x, y" ("2017, 50.4%"). Adding the axis name to every point made exploration slower to listen to; the axis names are spoken once when the chart gets focus.
- **Custom single-key shortcuts** (P play/pause, S summary, C confidence) are registered as Chart2Music hotkeys, so they only work while the chart has focus.
- **Arrow keys during a sweep pause it**, so exploring never fights with playback.
- **Eyes-closed mode** blanks the screen with a dialog, plays the sweep, then offers "Reveal the chart". Escape reveals at any time.
- **Reduced motion**: the playhead jumps from point to point instead of gliding.
- **A single-image upload opens its chart directly** when processing finishes, since a list with one item adds a step for nothing.

## Trust layer

- **Confidence model.** Each point starts at 1.0 and is multiplied by the chart's risk multiplier (the product of `1 - weight` over its risk factors) and by a penalty for each failed check on that point (`app/pipeline/confidence.py`, `POINT_PENALTY`). A point below 0.7 is "uncertain": it is announced as uncertain, gets the hiss cue, and is drawn as a hollow diamond with "?". Chart level: **low** if the photo is tilted, the mean is below 0.6, at least 30% of points are uncertain, or a value is more than 5% beyond the axis; **medium** if the mean is below 0.85 or any point is uncertain; otherwise **high**.
- **Check thresholds** are percentages of the axis range (log axes in log space): the two readings agree within 1.5%, disagree beyond 4%, x positions disagree beyond 3%; the pixel check accepts 2% and fails beyond 5%; a value more than 2% beyond the axis is out of range.
- **Pixel check** maps each first-reading value to pixels through the tick calibration of the second reading, then looks for ink of the series color in a narrow column there (lines) or measures where the bar actually ends (bars). Blur wears away the tips of thin lines, so for measurably blurry images (Laplacian variance below 60 at 900 px) the tolerances and the search column are doubled: the check can only be as precise as the image.
- **"No markers" and "few tick labels" interact.** Either one alone is a small risk (weights 0.08 and 0.10 per axis): markers pin the points, and ticks pin the values. Both together get an extra 0.25, because then nothing anchors the reading. This is the mechanism behind the measured `hs1_sparse_ticks` failure, and it does not fire on the log-scale chart (3 tick labels, with markers) or on the dense and three-similar charts (no markers, many ticks), which were measured as accurate.
- **Tilt is measured, not guessed.** Long straight lines (Hough transform at a fixed 900 px scale) give a length-weighted median deviation from horizontal and vertical, plus a spread (keystone). On the test set every flat chart measures 0.00 degrees and every phone photo 3.5 to 3.9 degrees; the threshold is 1.0 degree (or a keystone spread of 1.6 degrees).
- **Low resolution and blur are named but light** (weight 0.05 each). They were measured as accurate, so they appear as reasons without dropping a chart below high on their own.
- **A failed second reading is a risk factor** (weight 0.25): without it there is no cross-check and no pixel check, so the chart cannot be rated high.
- **On a tilted photo the cross-check may disagree even when values are right**, because the tick calibration is a straight-line fit per axis and cannot model perspective. That is still the correct outcome, since positions on such a photo are not reliable either way.
- **Straightening (stretch).** A tilted photo is straightened by finding the largest bright quadrilateral (the slide) with Otsu thresholding and a 4-point contour approximation, then warping it flat. In live mode the straightened copy is read again, and its reading replaces the original only if its confidence is higher. In fixture mode there is no reading for the straightened copy, so the app shows it and says re-reading needs live mode. The improvement is therefore implemented but has not been measured.
- **Fixture-mode limits.** Fixture readings come from the answer key, so in fixture mode the two readings agree and the pixel check passes on flat charts. Flags then come from risk factors and photo geometry. `tests/test_trust.py` injects the documented failure patterns (an x-shift near a peak, error growing left to right with a value above the axis, a local misreading, a wrong bar) into real images and checks that the cross-check and pixel check find and localize them.

## Document screen

- **Fixture mode paces the pipeline** with a short pause after each step (`FIXTURE_STEP_DELAY`, default 0.4 s), so the live progress view is visible in a demo instead of finishing in a blink. Live mode never waits. The fixture banner stays on screen throughout.
- **Progress announcements are batched**: one message per update ("Found 4 charts. Reading values."), and a full list of charts with their confidence when processing ends. Detail changes ("Chart 2 of 4") are shown but not spoken.
- **PDFs say which pages had no charts**, so a student knows nothing was silently skipped.

## Design pass (step 6)

Changes made after reviewing screenshots in both themes at 1280, 390 and 320 px:

- **The home chart is capped to half the viewport height**, so "Play graph" is above the fold on a 1280 by 900 laptop and on a 390 by 844 phone. The SVG overlay sits on a canvas that shrinks to the image, so the playhead stays aligned at any size.
- **A medium or low chart shows its warning right under the title** ("Shape only. Do not rely on exact values.") with a link to the reasons. The full confidence panel stays below, next to the summary, as the brief's layout asks.
- **In-page links never trigger the hash router.** The skip link and the "Why" link move focus to their target. This also fixed the skip link, which would otherwise have navigated home.
- **Eyes-closed mode makes the rest of the page `inert`**, so focus cannot leave the overlay. Escape or the button reveals the chart and returns focus.
- **The verification table drops units from its cells** (the header carries them), and on phones its confidence column shows the shape with the word available to screen readers only. Uncertain rows get a red bar at the start of the row instead of a full red fill, which was too loud when every point was uncertain.
- **Header labels shorten on phones** ("Shortcuts", "Voice: off") so the header fits on two rows.
- **Automated checks**: axe-core 4.13 (WCAG 2.0 to 2.2 A and AA plus best practices) reports zero violations on home, chart (listen and verify), document, the shortcuts dialog and the eyes-closed overlay, in light and dark, at 1280 and 390 px. No screen scrolls horizontally at 320 px. These run in `tests/test_e2e.py`.

## Packaging and robustness (step 8)

- **No system packages in the Docker image.** `opencv-python-headless` 5 runs on `python:3.11-slim` without extra libraries. Verified by building the image and processing the tilted-photo sample inside the container (tilt detection and straightening both use OpenCV). The container runs as a non-root user and listens on `$PORT`. In this build environment the Debian mirror is blocked and TLS is intercepted, so the verification build used a scratch copy of the Dockerfile that trusts the sandbox CA; the committed Dockerfile has no such workaround.
- **An uploaded image is read whole when the detector finds no chart in it.** The student chose the image, so the value reading decides (its `is_chart` field gives the "not a chart" message) instead of the detector silently ending the run.
- **The live path is tested with a fake SDK client** (`tests/test_live_path.py`): the real provider, prompts, schemas, parsing, validation, cache labeling and function calling run, and only the network call is replaced.

## First live run

- **The live API answered** with `gemini-3.8-flash`: the first test chart came back at 0.07% average error. It also returned frequent `503 UNAVAILABLE` ("high demand") responses.
- **Overloads are retried with backoff, not treated as bad output.** The SDK's built-in retry is off unless configured, so the client now sets it: 6 attempts with exponential backoff and jitter (about 2, 4, 8, 16, 30 s) on 408, 429 and 5xx. If the model is still overloaded, that one call is tried on `GEMINI_FALLBACK_MODEL`, and the chart records which model answered. Our own second attempt stays reserved for empty or malformed output.
- **A busy API is reported as busy.** The student sees "Gemini is busy right now ... Try again in a minute" instead of "could not be read". The eval marks such charts "not measured" and leaves them out of the targets; rerunning only asks for the missing charts, because finished ones are cached.
- **At most 4 parallel requests** by default (`GEMINI_MAX_CONCURRENCY`), down from 8, to be gentler on a busy API.
- **Automatic function calling is disabled explicitly** on the JSON calls too, which silences an SDK warning; the app never uses it.
- **A second reading skipped because Gemini was busy is named as such.** The chart still cannot be rated high without its cross-check, but the reason now says Gemini was busy and to try again, rather than implying the chart is hard to read. The eval marks such charts "partial": their errors count as measurements, but their level does not count toward the targets. A rerun completes them, and only the missing reading is requested (the first is cached).

## Busy and over-quota Gemini (second live run)

The owner's key kept hitting `429 RESOURCE_EXHAUSTED` (the free tier's per-minute and per-day request limits, counted per model) as well as `503` overloads, so charts could not be tested.

- **A model chain instead of one fallback.** `GEMINI_FALLBACK_MODEL` takes a comma-separated list (default `gemini-flash-latest,gemini-flash-lite-latest`). A call goes down the chain when a model is unknown (404, dropped for the session), overloaded or over quota. Because quotas are per model, the next model usually still answers. Each chart records the model that read it, so a reading from a lighter model is never presented as the configured one.
- **Busy models are skipped for a while.** A model that stays busy through the SDK's backoff is moved to the end of the chain for 60 seconds (an hour when the 429 names the daily limit), so later calls stop waiting on it. The SDK backoff is now 5 attempts (about 2, 4, 8, 16 s) per model, so a fully busy chain gives up in about two minutes instead of much longer.
- **Quota and overload are told apart.** The student hears "Gemini is busy right now (Google's servers are overloaded)", "this app has reached its per-minute request limit", or "this app has used up today's request limit", so "try again in a minute" is only promised when it can help. All three keep the "Gemini is busy" prefix that the eval uses.
- **One request fewer per uploaded image.** A single image is now read whole by default instead of first asking Gemini for chart boxes; the readings and the trust layer work on the whole image, and a phone photo is straightened from the whole frame anyway. `DETECT_IN_IMAGES=1` restores detection for screenshots that hold several charts. PDF pages are still detected (text-only pages make no request). A two-reading chart now costs 2 requests instead of 3.
- **"Try again" reads one chart again.** A chart Gemini was too busy to read, or whose cross-check was skipped, has a Try again button on the document and chart screens (live mode only). It reads the saved crop again; the reading that already worked comes from the cache, so only the missing one is requested.
- **`tools/list_models.py`** lists the models the key can use, and with `--ping` sends one tiny request to each flash model and reports "answers now", "429 over quota" or "503 overloaded", so the owner can pick `GEMINI_MODEL` and the chain from facts.
- **Questions skip the second attempt when every model is busy** and fall back to the rule-based chooser, saying "Gemini was busy" in the note.
- **Questions have a deadline** (`QA_DEADLINE_SECONDS`, 12 s). Measured on Vertex AI, 9 of 12 questions were routed in 1 to 4 s, but three took 30, 67 and 133 s: the readings' patient retry policy (SDK backoff, waiting out a per-minute quota, a 180 s timeout) also applied to questions. A student is waiting, often by voice, so after the deadline the rule chooser answers and the note says "Gemini was slow to answer". The Gemini call keeps running and caches its choice, so asking again uses it.

## Design v2 (redesign on request)

The owner asked for a more polished, professional site with an information page first, pointing to Dribbble shots (an art marketplace with scroll animation, an energy-company site, an AI-platform site). Dribbble and most design blogs are blocked in this environment, so the direction came from search summaries of those shots and of widely praised product sites (Linear-style dark hero and bento grid, SaaS landing-page roundups): outcome-first headline, the real product in the hero, a short proof strip, how it works, a bento feature grid with one large anchor tile, one dark band, FAQ, closing call to action.

- **Two areas.** `#/` is now a landing page that explains the product. The app moved to `#/app` ("Open the app"), and the document and chart screens are unchanged in function.
- **The hero shows the real product.** A product window plays the actual example chart (a compact "hero" variant of the player), with two decorative floating cards. They are `aria-hidden`, and the same facts appear in the page text.
- **Palette refined, not replaced.** Deep indigo night (`#0C0E2E`) for the hero, trust band and call to action; interactive indigo `#3B3ED6` (dark theme `#8E92FF`); signal yellow `#FFC72C` for the main call to action, the playhead and focus; cool off-white page `#F7F7FC`. Confidence colors and shapes are unchanged.
- **Type.** Same accessible family (Atkinson Hyperlegible Next), adding the 600 and 800 weights for display headings with tighter tracking. Body text is 18px.
- **Components.** Pill buttons, 16 to 22 px radius panels with a light shadow, a translucent sticky header, a timeline-style progress list, cards for chart rows and samples, a segmented Listen/Verify toggle.
- **Constraints from the first brief that this relaxes, at the owner's request:** subtle gradients (hero, trust band, call to action), card panels with soft shadows, and a gentle fade-up for a few landing blocks as they scroll in. Motion is still off under reduced motion, and buttons still have no arrows.
- **Accessibility held.** Landmarks, headings, skip link, focus ring and live regions are unchanged. Scrollable tables are now focusable labeled regions (needed once the verify table scrolls on phones). axe reports zero violations on the landing, app, chart (listen and verify) and document screens, in both themes, at 1280 and 390 px. No screen scrolls sideways at 320 px.
- **Honest marketing copy.** Every claim on the landing page is checked against the app: "2 readings", "4 trust checks", "0 accessibility violations in automated WCAG 2.2 AA checks", and "60 minutes". There is no "free" claim, and no time promise that a busy API could break.

## Google Cloud credentials (job 1)

- **Option names from the installed SDK.** `google-genai` 2.26 names the cloud backend `enterprise` (with `vertexai` as the legacy flag) and reads `GOOGLE_GENAI_USE_ENTERPRISE` (then `GOOGLE_GENAI_USE_VERTEXAI`), `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` (`google/genai/client.py`, `_api_client.py`). The app reads the same variables and passes them explicitly as `genai.Client(enterprise=True, project=..., location=...)`, so the choice is visible in one place (`app/gemini.py`, `make_client`).
- **Cloud wins over a key.** If `GOOGLE_GENAI_USE_ENTERPRISE=true`, the cloud backend is used even when `GEMINI_API_KEY` is set, and no key is sent (the SDK drops an environment key when project and location are explicit; a test checks this). Setting it is a deliberate choice, while a leftover key in `.env` is common.
- **The project is required; the location defaults to `global`.** Without `GOOGLE_CLOUD_PROJECT` the app stays in fixture mode and the banner says why. `global` is where Google serves the newest Gemini models.
- **Credentials are Application Default Credentials only.** No key files in the repo or the image. On Cloud Run the attached service account is used, with the Vertex AI User role.
- **The API key path is unchanged**: `genai.Client(api_key=..., http_options=...)` as before.
- **Startup check and errors name the backend.** Missing credentials say to run `gcloud auth application-default login`; a 403 says to enable the Vertex AI API and grant the role.
- **Model ids fall through the chain on either backend.** The startup check calls `models.get` for every model in the chain and drops those that answer 404, and a 404 at call time drops the model too, so an id that exists only on the Developer API does not stop a cloud run.
- **Backend shown to people.** `/api/health` has `backend` and `backend_label`; the footer says "This server reads charts with Gemini on Google Cloud (project ..., location ...), model ...". Chart records carry `backend`, and the chart screen says "Read by <model> on Google Cloud". Cached readings keep the backend that produced them.
- **Latency is recorded.** Each live call stores its wall time (including SDK backoff) in the cache entry and in `CallMeta.seconds`, for the evaluation's latency table.
- **Cloud Run settings.** One instance at most (documents, sessions and the pipeline's progress live in memory), 1 GiB memory (PyMuPDF renders, OpenCV and two images per chart in flight), `--no-cpu-throttling` because processing continues in a background thread after the upload request returns. The deploy commands are documented, not run: this environment has no Google Cloud project.
- **Flaky axe check fixed.** The dark-theme contrast check on the Listen/Verify toggle sometimes measured the button mid-transition. It failed on the previous commit too. The test helper now turns transitions off before axe runs.

## Trust layer false alarms (job 2)

The owner replayed the saved live readings against the answer keys and found false alarms. The live cache is on the owner's machine, not in this build environment, so each case was rebuilt here: from the fixture readings with the measured error shape injected (`tests/test_trust_regressions.py`), or drawn with matplotlib (`tests/synthetic.py`). `tools/replay_cache.py` replays the real cache; its numbers are what count, and they could not be run here.

- **(a) Keystone no longer triggers "tilted".** The spread of line angles was high on clean charts with one long straight sloped line (a linear trend, supply and demand, a regression line, a despined chart): 1.5 to 7.5 degrees on the synthetic charts, above the old 1.6 trigger. Three changes: strongly colored pixels (data series) are masked out before the Hough transform, because tilt is a property of the page (axes, gridlines, edges, text), not of the data; "tilted" now needs the median rotation of 1 degree or more, with keystone only adding "and in perspective" to the wording; and the median must be supported by at least two separate lines, because a single black sloped line on a chart with no spines is found by Hough as several segments of one line. Measured: every flat test chart and all 10 synthetic charts 0.00 degrees; the four phone photos 3.74 to 3.91 degrees; synthetic charts rotated by 3.5 degrees measure 3.29 to 3.32. Limit: thin-lined charts rotated by only 2 degrees were measured as 0 before and after (the rotated spines give a single Hough line), so small rotations of very clean charts are not detected.
- **(b) Priors limit the chart, evidence marks the points.** A point's confidence now comes only from the checks on that point. Structural risks (no markers, few tick labels, unanchored, low resolution, blur, uneven ticks, a missing second reading) multiply into a chart-level factor; below 0.85 it lowers a high chart to medium, and it never lowers a chart to low or marks a point uncertain. The weights are unchanged, so which combinations reach medium is as before (no markers alone, low resolution alone or blur alone stay high; few ticks with no markers, or no second reading, reach medium). The one exception is a tilted photo: perspective moves every position, so every point stays uncertain (factor 0.55) and the chart stays low until it is straightened and read again. `hs1_sparse_ticks` read within 2% is now medium with no uncertain points and the reason "Every point passed its checks, but nothing anchors the exact positions, an axis has few tick labels, and the line has no point markers, so a small misreading is harder to rule out."
- **"Close" is not a failure.** The penalties for a minor cross-check difference (1.5 to 4%) and for "close to the line" (2 to 5%) went from 0.8 to 0.85, so even both together (0.72) keep a point above the uncertain line. The verification view still draws such a point as medium (a triangle). Consequence, stated plainly: an error of 3 to 4% that only produces these soft findings is marked medium, not announced as uncertain. On the simulated replay below this is 3 of 19 real errors, all on `hs1`.
- **(c) The image decides between the two readings.** When the readings disagree (more than 4%, or a different x position) and the pixel check finds the first reading on the drawn line or bar, the point keeps full confidence, the flag becomes `second_reading_differs`, and the reasons say "The second reading differs at ..., but the first reading lies on the drawn line there". If the pixel check failed, was only "close", or could not run, the penalty stays. A minor difference is never reconciled; it stays a soft flag.
- **(d) End points.** For the first and last point of a line, when the search column finds no ink close enough, the check looks up to 1.5% of the plot width inward for the end of the line. A wrong last value is still caught (tested with 40.0 instead of 49.5 on `hs1`).
- **(e) Tick snapping.** The second reading's tick positions are moved onto the tick marks (dark, neutral runs touching the spine) and gridlines (thin neutral lines across most of the plot) found with OpenCV (`app/pipeline/snap.py`). Ticks are matched together, not one by one: the shared offset that lines up the most ticks with marks wins, a scale and offset fitted on those matches predicts every tick, and each tick snaps to a mark within a few pixels of its prediction, moving at most 0.45 of the tick spacing and never sharing a mark. Matching one tick at a time failed on `02_line_peak`: with a 16 px offset the lowest tick jumped to the bottom spine. The snapped fit is used only if at least 60% of the numeric ticks snapped and the fit is no less straight than before. `TICK_SNAP=0` turns it off. Measured on simulated tick errors over the 23 flat charts (3 seeds each, 1,125 points, first readings exact): correct points flagged by a check went from 704 to 223 with a systematic offset of 8 to 18 units, 135 to 66 with a 2 to 4% scale error, 45 to 35 with random jitter, and 3 to 3 with no error. It found no marks on the low-resolution and blurred `h02`, `h06`, `h08` copies or on `hs2`, so it changes nothing there. **Not yet confirmed on the real replay** (the cache is not here); run `python tools/replay_cache.py --baseline <commit before job 2>` and compare with `TICK_SNAP=0`.
- **(f) Wording matches the level.** The first reason now says why the level is what it is: "N points failed a check: ...", "Every point passed its checks, but ...", or the tilted-photo sentence ending "Every value is uncertain until the photo is straightened and read again." On a high chart, risks that changed nothing start with "Noted, but the checks passed:". The "unanchored" risk no longer says "off by up to a quarter of the axis", which contradicted a medium chart whose points all passed. A test checks every fixture chart for contradictions.
- **Replay tool.** `tools/replay_cache.py` finds the cached first and second readings for each test image by pixel hash (or the crops of an older run, from its cached detection), runs the trust layer, scores every point against the answer key (`eval/scoring.py`), and replays the straightened copy of a tilted photo if it was read live. `--baseline REV` runs the same replay with the trust layer of another commit (in a temporary git worktree) and prints both. Counts: a real error is more than 3% of the axis off, a correct point is within 1.5%, flagged means announced as uncertain; "marked" (medium or uncertain in the verification view) is reported separately.
- **Simulated before and after** (`--baseline 4e6f21b` on a cache built from the fixture readings with the measured error shapes injected: 0.3% noise, 2.1% on `hs1`, a 12-unit tick offset on four charts, second-reading outliers at `hs1` 18 and 19 m and `02` step 11, an end-point calibration shift on `hs1`, the growing error on `h05c`; this is a simulation, not live data): real errors caught 19 of 19 before, 16 of 19 after (the three misses are `hs1` points 3.0 to 3.2% off, now marked medium); false alarms 74 of 417 before, 55 after, all 55 on the four tilted photos (every point there is uncertain by design); levels before 18 high, 4 medium, 5 low, after 22 high, 1 medium (`hs1`), 4 low (the photos).

## Measuring live (job 3)

- **No live run from this environment.** The build environment for this session has no Gemini key and no Google Cloud project, and the owner's key and response cache live on the owner's machine. Everything below was built and run here in fixture mode; the live numbers come from running `python eval/run_eval.py` with credentials. `eval/results.md` in this commit is a fixture-mode run and says so at the top.
- **The eval counts points, not only charts.** Using `eval/scoring.py`: real errors caught (more than 3% of the axis off and announced as uncertain), real errors missed, false alarms (within 1.5% and announced as uncertain), and separately what the verification view marks as medium or uncertain. Totals are given for all charts and for charts that are not tilted photos, because every point of a tilted photo is uncertain by design until it is straightened. Chart-level results (levels, targets) are kept.
- **A busy API stops the run.** Two charts in a row with Gemini busy (429 or 503 after the backoff and the model chain), or with the second reading skipped for that reason, stop the run; finished readings stay cached, the report lists what was not run, and the PDF and questions are skipped. A rerun only asks for what is missing. No loop.
- **Latency.** Each chart records the time of the first reading, the second reading (each including the SDK's backoff), both together (they run in parallel), and the whole chart including any straightening. The straightened copy's two readings now also run in parallel. For cached charts the report shows the time measured when they were read live, and says how many charts came from the cache. The latency table is left out of fixture runs, where it means nothing.
- **Straightening is reported from readings already made.** For each tilted photo the report gives the error of the first reading of the photo and of the straightened copy against the answer key, the tilt before and after, the levels and whether the straightened reading was adopted. These come from the response cache of the same run; the report never calls Gemini again for them.
- **Questions through the HTTP API.** Twelve questions on three samples (`POST /api/charts/{id}/ask` via FastAPI's test client, so the real app state, provider and cache are used), including two that cannot be answered from the data. The report records the operation chosen, by whom (Gemini or rules), and the answer. In fixture mode the rule chooser got 10 of 12: it does not match "first go above 30" to `x_where`, and it answers a future-day question with `trend`. Left as is: live mode uses Gemini, and the rules are the fallback. With Gemini choosing (Vertex AI, gemini-3.5-flash, `eval/questions_gemini.json`), all 12 got the expected operation, including both cannot-answer questions.
- **Two medium messages.** The medium message "Exact values may be off by a few percent" contradicted a medium chart with an uncertain point 18% off (the injected `hs1` shift, now medium with two localized regions instead of low with "all values"). A medium chart with uncertain points now says "Most values passed the checks, but some are uncertain. Do not rely on the uncertain values."
- **Landing page.** "Works with VoiceOver, NVDA and JAWS" became "Built for screen readers and keyboard", and the FAQ says the app uses the standard live regions and passes automated checks but has not been tested with screen reader users. The accuracy answer now says "in the first live tests". The floating "Where is the maximum?" card hung over the player's status line ("13 points. Press Play graph to listen"); it now hangs below the product window, clear of the status line at 900 to 1440 px even at the top of its bobbing motion (measured with Playwright).

## Quota handling after the first full live run

The owner's live eval spent about two minutes per chart waiting: a daily-quota 429 was retried by the SDK for about 30 seconds per model, and once every model was cooling down, the chain started again with the model that was over its daily quota.

- **429 is no longer retried by the SDK.** It still backs off on 408 and 5xx. A daily-quota 429 moves straight to the next model and that model is not asked again for an hour. A per-minute 429 cools the model for the delay the API gives (`RetryInfo.retryDelay`, else 60 s).
- **Cooling models are tried soonest-ready first**, models over their daily quota not at all. If every model is over its daily quota, a call fails at once with the daily-limit message instead of making requests.
- **A per-minute quota is waited out** (up to 65 s) only when no other model is ready.

## Replaying the live cache

The owner committed the cached live readings of their first full live run (`eval/live_cache`: 8 charts, 7 with both readings; models `gemini-3.5-flash`, `3.6-flash` and `3.7-flash` as the chain fell through busy models). Replayed with `tools/replay_cache.py --cache eval/live_cache`:

- **The readings are very accurate**: average error 0.00 to 0.21% on the clean charts, worst point 0.59%; `hs1_sparse_ticks` 0.90% average, 2.14% worst. None of the 126 points is a real error (more than 3% off).
- **The remaining false alarms after job 2 came from the second reading's geometry, not the values.** On `05_line_two_series` Gemini reported the tick positions spread 9% too wide on x and 11% too tall on y. Snapping could not fix it, because a tick could move at most 0.45 of the tick spacing from where Gemini put it, and the end ticks were 31 px off with a 24 px limit. On `03_line_decay` the reported plot area's top edge was 60 px too low, so the first point's marker fell outside the area the pixel check searches.
- **Snapping now searches scale and offset together.** Every scale from 0.8 to 1.25, anchored by one tick on one drawn mark, predicts all ticks; the transform that lines up the most ticks with marks wins, among equals the one that moves the ticks least, and on average a tick may move at most half the tick spacing (more would mean matching one tick off). A least-squares fit on the matches then places every tick. On both charts the snapped calibration equals the one measured from the image by the fixture builder to four digits. On the simulated tick errors it is also better than before (scale errors: 46 flagged points instead of 66; jitter: 30 instead of 35).
- **The pixel check's search area covers the calibrated axis range**, not only Gemini's plot area.
- **Two soft findings together count as a failure.** Injecting errors of 4 to 12% of the axis into a quarter of the live first readings (seed 4, 27 real errors, live second readings untouched): the three errors that were missed (6.1 to 6.8% off) each had a minor cross-check difference and a "close to the line" result; no correct live point has both. A point with both is now uncertain, with the reason "both checks place the value a few percent off". This was retuned on this data, as the brief allows.
- **Result on the live cache**: false alarms 69 of 121 correct points before job 2, 8 after job 2, 0 now; levels 2 high, 2 medium, 4 low before, 5 high and 3 medium now (the 5 clean charts with both readings are high; `06` and `07` are medium because Gemini was busy for their second reading; `hs1` is medium from its structural risks). With the injected errors: 19 of 27 caught and 0 false alarms now, against 26 of 27 caught with 54 false alarms on 96 correct points before job 2. All 8 misses are on `06` and `07`, which have no second reading, so no pixel check could run there; the chart says so and offers Try again.
- **Regression tests** (`tests/test_live_replay.py`) replay the committed cache: no false alarms and the clean charts high, and every injected error caught on charts with both readings.

## Checking without a second reading, and the fallback question matcher

- **Image-only calibration.** When the second reading fails (Gemini busy or invalid output), the axes are now calibrated from the first reading's tick labels and the tick marks and gridlines found in the image: the left and bottom axis lines give the plot frame, the marks along them are found as in tick snapping, and the sorted tick values are paired with the run of consecutive marks that gives the straightest fit (residual at most 1% of the axis). The pixel check then runs; the cross-check cannot. On the clean test charts the result matches the second-reading calibration within 0.4 px. Log axes are skipped (minor tick marks were matched to the labels, 290 px off on `hs3`), and images where no axis lines are found (photos, low-resolution and blurred copies, despined charts) keep the old behaviour. The chart stays medium at most, and the reason says the values "were checked against the image only, not against a second reading".
- **Measured on the live cache with injected errors:** 24 of 27 caught (19 before), 0 false alarms. On `06_line_dense` and `07_bar_simple`, which have no second reading, 5 of 8 are now caught (0 before).
- **Fallback question matcher.** The rule matcher (fixture mode, and the fallback when Gemini is unavailable) now maps "first go above 30", "drop below 10" and similar to `x_where`, treating a number after above, below, over, under, exceed, than or reach as a value even when it is also an x value; and it answers questions about what comes next (will, next, predict, forecast, future, tomorrow) with "cannot answer" instead of a trend.

## Limits for a public deployment

- **Why.** A public Cloud Run URL lets anyone start Gemini calls on the owner's credits.
- **What.** Per visitor and sliding hour: 20 new files (uploads and samples), 120 questions, 30 retries; and 500 new files a day for the whole server. A refusal is a 429 with a plain message ("Too many files from this connection in the last hour. Try again in about N minutes."). In memory, which fits the one-instance deployment; all values are environment variables, 0 turns a limit off.
- **Visitor address.** The last `X-Forwarded-For` entry, the one Google's front end adds; earlier entries come from the client and could be made up to dodge the limit. The daily cap is the backstop either way. A budget alert on the Google Cloud project is still recommended.

## Second live run: 13 charts replayed

A second live run (the owner's key, in a fresh session; `gemini-3.8-flash` with fallbacks) added `08`, `09`, `10`, `h02a_lowres`, `h02b_jpeg_blur` before every flash model hit its daily quota. Readings stay excellent: worst point 0.84% on the clean charts. Replaying all 13 cached charts found four false alarms, each on correct values, each fixed with a test:

- **Bars colored by sign** (`09_bar_negative`: positive bars green, negative bars red; the first reading gave the series one color). The pixel check found no ink of that color on the red bars. For bars, when the series color is not in a bar's column, the bar end is now measured on any colored ink in that column.
- **Bar positions without a second reading** (`10_bar_offset_axis`). Categories were placed evenly across the plot frame, but matplotlib's margins put the end bars about 25 px from that, outside the bar. The bars are now found in the image (runs of colored columns) and used when their count matches the categories.
- **A second reading 2 to 3% off on every point** (`03_line_decay`, with the image confirming the first reading). A minor difference is now reconciled when the value lies within 1% of the drawn mark.
- **Gemini's tick positions 7 to 11% off where no tick marks can be found** (`h02a_lowres`, `h02b_jpeg_blur`). Against the answer key, Gemini's ticks put y = 45 14 px (low resolution) and 27 px (blur) from the truth, while the plot frame found in the image plus the first reading's axis limits was within 2 px. On the blurred chart the doubled blur tolerance had been hiding the 7% calibration error. Now, when ticks cannot be snapped and the tick calibration and the frame disagree by more than 2% of the axis (4% on blurry images), the pixel check is skipped for that chart and a risk says "The axes in the image could not be matched precisely to the tick labels, so the values were checked against the second reading only". The frame calibration is not adopted, because it rests on the first reading's axis limits: a first reading that misread an axis and its values the same way would pass. Low-resolution and blurred frames are found with a lighter threshold (gray below 230) and must form a consistent box.
- **End points could overrule the second reading wrongly.** Injecting errors over five random seeds showed large errors at first and last points (15% on `hs1` at 20 m, 7% on `04`) passing: the inward search for the end of a steep line found the line at the wrong value's height, and that "confirmation" overruled the cross-check's correct disagreement. A pixel match found by the end search no longer overrules the second reading.

**Result on the 13 live charts**: 0 false alarms on 172 correct points; 9 high, 4 medium (`10` without a second reading, `h02a` and `h02b` uncalibrated, `hs1` structural). **Injected errors** (4 to 12% of the axis into a quarter of the points, five seeds): 183 of 190 caught, 0 false alarms on 675 correct points. The 7 misses are errors of 4 to 7% that only one check saw as slightly off (the soft band), or on the chart without a second reading.

The model can still be wrong in ways these checks share: the not-yet-measured hard charts (photos, log scale, hand-drawn, grouped bars, three similar lines) and the straightening are still to be run live.

## All 27 charts read live

This session got the key and read the 14 remaining hard charts live (`gemini-3.5-flash`, then `gemini-3-flash-preview` and `gemini-3.5-flash-lite` as quotas ran out). Every chart has now been read live at least once.

- **Straightening works.** The first readings of the four phone photos were off by 5 to 6% on average (worst 8.4 to 19.1%), and every point was flagged (52 of 52 real errors caught). The straightened copies read at 0.00 to 0.44% average error and were adopted on all four.
- **The checks no longer lean on the reading they check.** When the second reading's ticks cannot be confirmed by tick marks in the image, the pixel check now calibrates from the first reading's tick labels and the marks (gridlines included, counted only where bars do not hide them; a plot without a left axis line is framed by its bottom axis and top gridline), and bars are found in the image, touching bars split by color. On `hs2_grouped_bars` the lighter model's second reading put the bars 60% off; the image now confirms the first reading and the chart is high.
- **A second reading whose own ticks contradict each other is not used** (`hs4`: two labels at one height; tick-fit residual 0.065 where every other live reading is at most 0.003; limit 0.03).
- **Log axes**: tick labels that lost their superscripts ("101", "102", "103") are read as powers of ten; tick snapping is off on log axes (minor tick marks).
- **Axis range**: a value between the last tick label and the plot edge is inside the axis. The sanity check now uses the range the calibrated plot area covers, or one tick step beyond the labels when the reading gave the tick range as the axis range.
- **Overruling the second reading needs a clear match**: within the normal 2% tolerance (not the blur-widened one), and not where another line of nearly the same color runs within 5%. Before, a 4% error on a blurred chart and a 9.5% error on three similar blue lines were "confirmed" and passed.
- **Result on all 27 live charts**: 52 of 52 real errors caught (all on the photos before straightening). False alarms: 43 of 379 correct points: 10 on the photos before straightening (by design) and 33 on three charts whose second reading came from the lighter model and where the image cannot decide (`hs5`, three lines of nearly the same blue: 23; `hs3`, the lighter model misplaced the log labels by 30%: 7; `h08a`, low resolution: 3). With errors injected into all 27 live readings (seed 4): 131 of 133 caught; the two misses are on `hs4`, whose second reading was unusable and whose axes the image does not show clearly. The lighter models are noticeably worse second readers; a chain of full flash models is recommended.
- **Latency** (live calls, including backoff while models were busy): first reading median 19.6 s, second reading 12.4 s, whole chart 28.1 s (median), 73.7 s worst (a photo that was straightened and read again).

## Demo samples from saved readings, and the report from the saved cache

- **Demo cache.** `tools/build_demo_cache.py` copies the saved live readings of the built-in samples (both readings, and for the phone photo also the straightened copy's) into `app/demo_cache`. The response cache reads it as a read-only seed, looked up by image and task whatever model was configured, so in live mode the samples open at once and never wait on a busy Gemini. They are labeled "Saved model output from ...", like any cached reading. Uploads are not affected. The lecture PDF is included too: its 4 charts were read live on Vertex AI (gemini-3.5-flash), all high, 0.02% average error over 47 points (worst 0.47%, on the five-bar enrollment chart). A PDF's crops are only known by running the pipeline, so the tool replays it with every API call refused and copies the saved readings it used. `--only <sample>` adds samples without rebuilding the folder, because straightening is not bit-identical across platforms: on macOS the straightened phone photo hashes differently, so a full rebuild there would drop its readings.
- **Prompt version check.** Seed entries are used only if they were made with the current prompts: either the entry records `prompt_version` (every cache entry now does), or its file name is the cache key for one of the models in the folder.
- **`run_eval.py --cache-only`** rebuilds the full report from `eval/live_cache` with no API calls: a reading that was never saved is reported as not measured, and the questions are skipped (they go through the app, which would call Gemini). This is how `eval/results.md` is produced now that the live readings span several runs and models.

## Ask by voice

- **The browser's speech recognition, not Gemini.** The Web Speech API is built into Chrome, Edge and Safari, costs nothing, and returns text in about a second. The text is then asked exactly like a typed question, so the rule that every number comes from code is unchanged. Where the API is missing (Firefox) the button, the help sentence and the shortcut row are hidden rather than shown disabled.
- **A tone, not words, says "speak now".** Announcing "Listening" through the live region would be read aloud by the screen reader (or the built-in voice) while the microphone is open and end up in the question. A rising two-note tone plays when recognition has started, a falling one when it ends; the built-in voice and the chart sound are stopped first. The "Listening" text is shown but not announced.
- **Asked as soon as the speaker stops, and repeated back.** No extra key press: the recognizer ends on silence (15 s at most) and the question is sent. The answer is announced as "You asked: (heard text). (answer)", so a misheard question is caught at once; asking again is one key away.
- **The tone waits for the microphone.** Tested with real speech in Chrome: "audiostart" came 4 s after "start" (the input was a Continuity iPhone microphone), so a tone on "start" would have made the student talk into a closed microphone. The tone plays on "audiostart"; until then the screen shows "Starting the microphone".
- **A stalled recognizer still asks what it heard.** In the same test Chrome sent "what is the rate" as interim text and then nothing, with no final result and no end. After 2 s without new words the app stops recognition, and if no final text came it asks the last text heard (repeated back as "You asked: ..."). An empty result, which Chrome can send when stopped, never erases the text heard so far.
- **V while the chart has focus**, like the other single-key shortcuts, so it never clashes with screen reader keys. Pressing the button again stops listening and asks what was heard.
- **Plain error messages** for a blocked microphone, no microphone, no speech heard, or no network, announced assertively. Nothing is asked after an error.
- **Spoken numbers.** Speech to text often writes "step seven" or "above thirty". Gemini understands those, and the rule matcher (fixture mode, or when Gemini is slow) now turns number words into digits first. "And" never joins two numbers ("between two and five") and a bare "one" stays a word ("which one is higher").
- **Privacy is stated.** In Chrome the audio goes to Google's speech service; the help text under the question box says so.
- **Tested** with Playwright and a stand-in recognizer (interim then final text, errors, the V key, no API), and axe still reports zero violations with the button present.

- **Website files are revalidated** (`Cache-Control: no-cache`). Without a header, Chrome cached the old `chart.js` after a redeploy, so the new voice button did not appear for a returning visitor. Every file is now checked with its ETag on load (a 304 when unchanged), so a redeploy reaches everyone at once.
