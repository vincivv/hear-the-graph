# Test data

- `clean/`: 10 matplotlib charts. `truth.json` has the exact data for each (keyed by filename without .png).
- `hard/`: 17 harder charts. `truth_hard.json` has the exact data. Files `h02*`, `h05*`, `h06*`, `h08*` are degraded copies of the clean charts (a = low-res, b = JPEG + blur, c = simulated tilted phone photo). `hs*` are new styles (sparse ticks, grouped bars, log scale, hand-drawn, three similar lines).
- `pdf/sample_lecture.pdf`: 6-page slide deck. `truth_pdf.json` lists which pages contain which charts (page 5 has two).

Never send the truth files to the model. They are the answer key for evaluation only.

Known results with Gemini Flash reading values directly (error as % of axis range):
clean charts, blur, low-res, log scale, overlapping lines, hand-drawn: under 0.5%.
`hs1_sparse_ticks`: avg 3.5%, worst 23.6% (points shifted along x near the peak).
`h05c_phone_photo`: avg 5.2%, worst 12.6% (error grows left to right from perspective tilt; returned 72.4 on an axis that tops out at 70).
