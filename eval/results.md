# Evaluation results

Run 2026-10-02 18:57. Mode: **live readings, replayed from the saved cache**. Gemini API with an API key Replayed from saved live readings (eval/live_cache); no new API calls.

> 27 of 27 charts came from the response cache (saved live output from an earlier run, same prompts and model); their latency is the time measured when they were read.

> **1 chart was only partly checked** because Gemini was busy during the second reading: 10_bar_offset_axis. Their errors are real measurements, but their level is not counted toward the targets.

## Summary

- **Charts measured: 27 of 27**, 448 points.
- **Average error over all measured charts: 0.13%** (mean of per-chart averages); worst single point 2.15%.
- **Real errors caught: 0 of 0** (points more than 3% of the axis off that were announced as uncertain). Marked medium or uncertain in the verification view: 0 of 0.
- **False alarms: 33 of 440** correct points (within 1.5%) were announced as uncertain; 33 of 369 on charts that are not tilted photos (every point of a tilted photo is uncertain until it is straightened).
- **Chart levels:** 16 high, 8 medium, 3 low. Trust-layer targets met: 11 of 11 (clean charts not flagged; `hs1_sparse_ticks` and `h05c_phone_photo` flagged, meaning medium or low).
- **Tilted photos:** straightened and read again on 4, adopted on 4. Average error of the photo's reading 4.96% to 6.30%; of the straightened copy 0.00% to 0.44% (the table below scores the reading the app kept).
- **Sample PDF: 4 charts on pages 2, 4, 5, 5** (expected 4 on pages 2, 4, 5, 5): pass; 4 of 4 charts were not read (no live reading saved), so the charts were found from the PDF's own image placements; 3.1 s end to end.

## Accuracy and trust layer

| Chart | Set | Model (first / second reading) | Avg error | Worst error | Missed | Level | Real errors caught | False alarms | Target | Risk factors |
|---|---|---|---|---|---|---|---|---|---|---|
| `01_line_rising` | clean | gemini-3.5-flash / gemini-3.6-flash | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 11 | no flag (met) | none |
| `02_line_peak` | clean | gemini-3.5-flash / gemini-3.7-flash | 0.07% | 0.23% | 0 | high | 0 of 0 | 0 of 13 | no flag (met) | none |
| `03_line_decay` | clean | gemini-3.7-flash / gemini-3.6-flash | 0.21% | 0.42% | 0 | high | 0 of 0 | 0 of 10 | no flag (met) | none |
| `04_line_negative` | clean | gemini-3.5-flash / gemini-3.7-flash | 0.05% | 0.31% | 0 | high | 0 of 0 | 0 of 13 | no flag (met) | none |
| `05_line_two_series` | clean | gemini-3.6-flash | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 22 | no flag (met) | none |
| `06_line_dense` | clean | gemini-3.6-flash | 0.10% | 0.59% | 0 | high | 0 of 0 | 0 of 31 | no flag (met) | no_markers |
| `07_bar_simple` | clean | gemini-3.6-flash / gemini-3.7-flash | 0.14% | 0.24% | 0 | high | 0 of 0 | 0 of 5 | no flag (met) | none |
| `08_bar_decimal` | clean | gemini-3.6-flash | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 7 | no flag (met) | none |
| `09_bar_negative` | clean | gemini-3.5-flash | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 6 | no flag (met) | none |
| `10_bar_offset_axis` | clean | gemini-3.5-flash | 0.00% | 0.00% | 0 | medium (partial) | 0 of 0 | 0 of 12 | no flag | unverified |
| `h02a_lowres` | hard | gemini-3.5-flash | 0.00% | 0.00% | 0 | medium | 0 of 0 | 0 of 13 | none | low_resolution, uncalibrated |
| `h02b_jpeg_blur` | hard | gemini-3.5-flash | 0.09% | 0.23% | 0 | medium | 0 of 0 | 0 of 13 | none | blurry, uncalibrated |
| `h02c_phone_photo` | hard | gemini-3-flash-preview | 0.02% | 0.23% | 0 | high | 0 of 0 | 0 of 13 | none | blurry |
| `h05a_lowres` | hard | gemini-3-flash-preview | 0.02% | 0.45% | 0 | high | 0 of 0 | 0 of 22 | none | low_resolution |
| `h05b_jpeg_blur` | hard | gemini-3-flash-preview | 0.08% | 0.45% | 0 | high | 0 of 0 | 0 of 22 | none | blurry |
| `h05c_phone_photo` | hard | gemini-3-flash-preview | 0.00% | 0.00% | 0 | medium | 0 of 0 | 0 of 22 | flag (met) | blurry, uncalibrated |
| `h06a_lowres` | hard | gemini-3-flash-preview | 0.22% | 0.72% | 0 | medium | 0 of 0 | 0 of 31 | none | no_markers, low_resolution, uncalibrated |
| `h06b_jpeg_blur` | hard | gemini-3-flash-preview | 0.68% | 1.56% | 0 | medium | 0 of 0 | 0 of 30 | none | no_markers, blurry, uncalibrated |
| `h06c_phone_photo` | hard | gemini-3-flash-preview | 0.44% | 2.15% | 0 | high | 0 of 0 | 0 of 29 | none | no_markers, blurry |
| `h08a_lowres` | hard | gemini-3.5-flash-lite | 0.19% | 1.34% | 0 | low | 0 of 0 | 3 of 7 | none | low_resolution, uncalibrated |
| `h08b_jpeg_blur` | hard | gemini-3.5-flash-lite | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 7 | none | blurry |
| `h08c_phone_photo` | hard | gemini-3.5-flash-lite | 0.00% | 0.00% | 0 | high | 0 of 0 | 0 of 7 | none | blurry |
| `hs1_sparse_ticks` | hard | gemini-3.5-flash | 0.90% | 2.14% | 0 | medium | 0 of 0 | 0 of 16 | flag (met) | no_markers, few_ticks_x, few_ticks_y, unanchored |
| `hs2_grouped_bars` | hard | gemini-3.5-flash-lite | 0.03% | 0.32% | 0 | high | 0 of 0 | 0 of 10 | none | none |
| `hs3_log_scale` | hard | gemini-3.5-flash-lite | 0.28% | 0.54% | 0 | low | 0 of 0 | 7 of 9 | none | few_ticks_y |
| `hs4_hand_drawn` | hard | gemini-3.5-flash-lite | 0.00% | 0.00% | 0 | medium | 0 of 0 | 0 of 11 | none | unverified |
| `hs5_three_similar` | hard | gemini-3.5-flash-lite | 0.03% | 0.45% | 0 | low | 0 of 0 | 23 of 48 | none | no_markers |

Error is the absolute difference between extracted and true value, as a percent of the axis range (the true data span plus 5% each side; log axes in log10 space). Missed: true points with no extracted point near their x position. A real error is more than 3% off; a false alarm is a point within 1.5% that was announced as uncertain.

## Latency

Seconds per chart. The two readings run in parallel; each call's time includes the SDK's backoff when Gemini was busy. "Total" is the whole chart: readings, checks, straightening of a tilted photo, summary.

| Chart | First reading | Second reading | Both readings (wall) | Total | Source |
|---|---|---|---|---|---|
| `01_line_rising` | 25.0 | 127.1 | 0.0 | 1.2 | cache |
| `02_line_peak` | 0.0 | 0.0 | 0.0 | 0.1 | cache |
| `03_line_decay` | 96.1 | 61.1 | 0.0 | 0.1 | cache |
| `04_line_negative` | 49.4 | 99.3 | 0.0 | 0.1 | cache |
| `05_line_two_series` | 10.5 | 15.7 | 0.0 | 0.1 | cache |
| `06_line_dense` | 11.6 | 29.7 | 0.0 | 0.1 | cache |
| `07_bar_simple` | 76.0 | 151.1 | 0.0 | 0.1 | cache |
| `08_bar_decimal` | 27.1 | 8.9 | 0.0 | 0.1 | cache |
| `09_bar_negative` | 22.4 | 39.6 | 0.0 | 0.1 | cache |
| `10_bar_offset_axis` | 18.6 | n/a | 0.0 | 0.1 | cache |
| `h02a_lowres` | 107.1 | 77.6 | 0.0 | 0.0 | cache |
| `h02b_jpeg_blur` | 26.3 | 23.8 | 0.0 | 0.1 | cache |
| `h02c_phone_photo` | 19.6 | 12.4 | 0.0 | 0.5 | cache |
| `h05a_lowres` | 19.8 | 55.6 | 0.0 | 0.1 | cache |
| `h05b_jpeg_blur` | 38.0 | 53.4 | 0.0 | 0.1 | cache |
| `h05c_phone_photo` | 45.3 | 28.5 | 0.0 | 0.4 | cache |
| `h06a_lowres` | 19.1 | 23.3 | 0.0 | 0.1 | cache |
| `h06b_jpeg_blur` | 35.8 | 29.0 | 0.0 | 0.1 | cache |
| `h06c_phone_photo` | 27.7 | 31.0 | 0.0 | 0.4 | cache |
| `h08a_lowres` | 2.1 | 2.9 | 0.0 | 0.0 | cache |
| `h08b_jpeg_blur` | 2.2 | 2.5 | 0.0 | 0.1 | cache |
| `h08c_phone_photo` | 24.9 | 2.8 | 0.0 | 0.5 | cache |
| `hs1_sparse_ticks` | 0.0 | 0.0 | 0.0 | 0.1 | cache |
| `hs2_grouped_bars` | 3.0 | 3.4 | 0.0 | 0.1 | cache |
| `hs3_log_scale` | 2.5 | 3.2 | 0.0 | 0.2 | cache |
| `hs4_hand_drawn` | 2.5 | 3.2 | 0.0 | 0.1 | cache |
| `hs5_three_similar` | 5.9 | 6.4 | 0.0 | 0.1 | cache |

## Tilted photos and straightening

Error of the first reading of the photo and of the straightened copy, against the answer key. The straightened reading is adopted only if its confidence is higher.

| Photo | Tilt before / after | Before: avg, worst | After: avg, worst | Level before / after | Adopted | Note |
|---|---|---|---|---|---|---|
| `h02c_phone_photo` | 3.8 / 0.0 | 5.15%, 8.43% | 0.02%, 0.23% | low / high | yes | Straightened the tilted photo and read it again. Confidence went from low to high. |
| `h05c_phone_photo` | 3.7 / 0.0 | 4.96%, 10.45% | 0.00%, 0.00% | low / medium | yes | Straightened the tilted photo and read it again. Confidence went from low to medium. |
| `h06c_phone_photo` | 3.8 / 0.0 | 6.10%, 19.12% | 0.44%, 2.15% | low / high | yes | Straightened the tilted photo and read it again. Confidence went from low to high. |
| `h08c_phone_photo` | 3.9 / 0.0 | 6.30%, 12.03% | 0.00%, 0.00% | low / high | yes | Straightened the tilted photo and read it again. Confidence went from low to high. |

## Injected failures (simulated, not model output)

The first reading is perturbed the way Gemini was measured to fail. The second reading and the image are untouched, so the cross-check and the pixel check have to find the wrong values on their own. These cases also run as tests in `tests/test_trust.py`.

| Chart | What was injected | Avg error | Worst error | Real errors caught | False alarms | Level | Uncertain regions |
|---|---|---|---|---|---|---|---|
| `hs1_sparse_ticks` | Values shifted one step along x near the peak (the measured hs1 failure) | 3.35% | 18.06% | 5 of 5 | 0 | medium | values from distance 3 m to distance 5 m; values from distance 7 m to distance 8 m |
| `05_line_two_series` | Error growing left to right, last value 72.4 above a 70 axis (the measured h05c pattern, on the flat chart) | 5.95% | 12.73% | 16 of 16 | 0 | low | Program A: values from 2019 to 2026; Program B: values from 2019 to 2026 |
| `02_line_peak` | Three points misread by about 10% of the axis | 2.10% | 9.11% | 3 of 3 | 0 | medium | values from step 5 to step 7 |
| `08_bar_decimal` | One bar misread (Wed 3.5 instead of 2.1) | 2.67% | 18.72% | 1 of 1 | 0 | medium | the value for Wed |
