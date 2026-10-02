// Chart screen: the player, then summary, questions, confidence and data.

import { api } from "../api.js";
import { announce } from "../announce.js";
import { esc, chartFormat, fmtNum, levelBadge, levelIcon, typeName, LEVEL_TEXT } from "../util.js";
import { ChartPlayer, isUncertain } from "../player.js";
import { VoiceInput, canListen } from "../listen.js";

const MIC_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const OP_TEXT = {
  max: "found the highest value", min: "found the lowest value", value_at: "looked up the value at that point",
  x_where: "searched for where the data reaches that value", trend: "measured the change between two points",
  slope: "computed the average rate of change", average: "averaged the plotted values", range: "took highest minus lowest",
  compare: "compared two series at one point", crossings: "found where two series cross", describe: "read the summary",
};

export function dataTable(chart) {
  const { fy, fx } = chartFormat(chart);
  const all = chart.series.every((s) => s.points.every(isUncertain));
  const note = all ? `<p class="small soft">All values in this chart are uncertain. Treat them as the shape only.</p>` : "";
  return note + `<div class="tables">` + chart.series.map((s, si) => `
    <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(s.name)} data, scrolls sideways if needed">
      <table id="table-${si}">
        <caption>${esc(s.name)}${all ? " (all values uncertain)" : ""}</caption>
        <thead><tr><th scope="col">${esc(chart.x_axis.label || "x")}</th><th scope="col" class="num">${esc(chart.y_axis.label || "Value")}</th></tr></thead>
        <tbody>${s.points.map((p, pi) => `<tr data-s="${si}" data-p="${pi}"><th scope="row">${esc(fx(p))}</th><td class="num">${esc(fy(p.y))}${isUncertain(p) && !all ? " (uncertain)" : ""}</td></tr>`).join("")}</tbody>
      </table>
    </div>`).join("") + `</div>`;
}

function suggestions(chart) {
  const s = chart.series[0];
  const mid = s.points[Math.floor(s.points.length / 2)];
  const out = ["Where is the maximum?", `What is the value at ${mid.x_label}?`];
  if (chart.series.length >= 2) {
    out.push(chart.chart_type === "bar" ? `Compare ${chart.series[0].name} and ${chart.series[1].name} at ${mid.x_label}` : "Where do the lines cross?");
  } else if (chart.x_axis.scale !== "category") {
    out.push(`What is the trend from ${s.points[0].x_label} to ${mid.x_label}?`);
  } else {
    out.push("What is the average?");
  }
  out.push("Describe the chart");
  return out;
}

function answerItem(a) {
  const how = a.answerable
    ? `How: code ${OP_TEXT[a.operation] || "ran a calculation"}. ${a.chooser_note}`
    : a.chooser_note;
  return `<li>
    <span class="q">You asked: ${esc(a.question)}</span>
    <span class="a">${esc(a.answer)}</span>
    ${a.answerable ? `<span class="how">${levelBadge(a.confidence)} ${esc(a.confidence_note && a.confidence !== "high" ? a.confidence_note : "")}</span>` : ""}
    <span class="how">${esc(how)}</span>
  </li>`;
}

const MARK_SVG = {
  high: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="#136F45" stroke="#fff" stroke-width="2"/></svg>`,
  medium: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 L17.5 16 L2.5 16 Z" fill="#8A5300" stroke="#fff" stroke-width="2"/></svg>`,
  low: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L18 10 L10 18 L2 10 Z" fill="#fff" stroke="#B42318" stroke-width="2.5"/><text x="10" y="13.5" text-anchor="middle" font-size="9" font-weight="700" fill="#B42318">?</text></svg>`,
};

function pointLevel(p) { return p.confidence >= 0.85 ? "high" : p.confidence >= 0.7 && !isUncertain(p) ? "medium" : "low"; }

function pixelText(p) {
  const v = p.checks?.pixel_off_pct;
  if (p.flags.includes("pixel_missing") || p.flags.includes("off_image")) return "Not found";
  if (v === undefined) return "Not checked";
  if (v === null) return "Not found";
  if (p.flags.includes("pixel_off")) return `No, ${v.toFixed(1)}% away`;
  if (p.flags.includes("pixel_near")) return `Close, ${v.toFixed(1)}% away`;
  return "Yes";
}

function verifyTable(chart) {
  const { fx, dec } = chartFormat(chart);
  const fy = (v) => fmtNum(v, chart.y_axis.scale === "log" ? 2 : dec);
  const unit = chart.y_axis.unit ? ` (${chart.y_axis.unit})` : "";
  return chart.series.map((s, si) => `
    <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(s.name)} checks, scrolls sideways if needed">
      <table>
        <caption>${esc(s.name)}: extracted points and checks</caption>
        <thead><tr>
          <th scope="col">${esc(chart.x_axis.label || "x")}</th><th scope="col" class="num">Value${esc(unit)}</th>
          <th scope="col" class="num">Second reading</th><th scope="col">On the drawn ${chart.chart_type === "bar" ? "bar" : "line"}?</th><th scope="col">Confidence</th>
        </tr></thead>
        <tbody>${s.points.map((p, pi) => {
          const lvl = pointLevel(p);
          const second = p.checks?.second_reading_y;
          return `<tr data-s="${si}" data-p="${pi}" class="lvl-${lvl}">
            <th scope="row">${esc(fx(p))}</th>
            <td class="num">${esc(fy(p.y))}</td>
            <td class="num">${second === undefined ? "None" : esc(fy(second))}</td>
            <td>${esc(pixelText(p))}</td>
            <td><span class="level ${lvl}">${MARK_SVG[lvl]}<span class="conf-word">${lvl === "low" ? "Uncertain" : lvl === "medium" ? "Medium" : "High"}</span></span>
              <span class="visually-hidden">, score ${p.confidence.toFixed(2)}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`).join("");
}

function verifyExtra(chart) {
  const st = chart.straightened;
  let straight = "";
  if (st) {
    const before = st.used ? api.chartImage(chart.id, "photo") : api.chartImage(chart.id);
    const after = st.used ? api.chartImage(chart.id) : api.chartImage(chart.id, "straightened");
    straight = `
      <h3>Tilted photo</h3>
      <p>${esc(st.note)}</p>
      <div class="straightened">
        <figure><img src="${esc(before)}" alt="The original photo, taken at an angle."><figcaption>Original photo</figcaption></figure>
        <figure><img src="${esc(after)}" alt="The same chart after straightening."><figcaption>Straightened</figcaption></figure>
      </div>`;
  }
  return `
    <ul class="legend" aria-label="Marks on the chart">
      <li>${MARK_SVG.high}<span>High confidence</span></li>
      <li>${MARK_SVG.medium}<span>Medium</span></li>
      <li>${MARK_SVG.low}<span>Uncertain</span></li>
    </ul>
    <p class="small soft">Each mark is drawn where the extracted value would sit on this image. A mark off the line or bar means the value is probably wrong.</p>
    ${straight}`;
}

function confidencePanel(chart) {
  const c = chart.confidence;
  const regions = c.uncertain_regions || [];
  return `
    <section aria-labelledby="conf-title" class="panel confidence-panel ${esc(c.level)}">
      <div class="panel-head"><h2 id="conf-title">Confidence</h2>${levelBadge(c.level)}</div>
      <p class="message">${esc(c.message)}</p>
      ${regions.length ? `<h3>Uncertain</h3><ul>${regions.map((r) => `<li>${esc(r.text[0].toUpperCase() + r.text.slice(1))}</li>`).join("")}</ul>` : ""}
      <h3>Why</h3>
      <ul>${(c.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <button type="button" class="btn btn-secondary" id="read-confidence">Read confidence</button>
    </section>`;
}

export async function renderChart(ctx, id) {
  const { main } = ctx;
  let chart;
  try {
    chart = await api.chart(id);
  } catch (e) {
    main.innerHTML = `<div class="container app-page"><header class="page-head"><h1>Chart not available</h1></header><div class="error-box"><p>${esc(e.message)}</p></div><p><a href="#/app">Open another file</a></p></div>`;
    ctx.setTitle("Chart not available");
    return;
  }
  const ok = chart.status === "ok";
  const conf = chart.confidence;
  const retry = chart.retryable && chart.mode === "live" ? `
    <div class="retry-row">
      <button type="button" class="btn btn-secondary btn-sm" id="retry-chart">${ok ? "Run the full check again" : "Try again"}</button>
      <span class="small soft" id="retry-status" role="status"></span>
    </div>` : "";
  main.innerHTML = `
  <div class="container app-page">
    <a class="back" href="#/doc/${esc(chart.document_id)}">All charts in ${esc(chart.document.filename)}</a>
    <header class="page-head chart-head">
      <div>
        <h1>${esc(chart.title || "Untitled chart")}</h1>
        <p class="meta"><span>Page ${chart.page}</span><span>${esc(typeName(chart.chart_type))}</span>${ok ? levelBadge(conf.level) : ""}${ok && chart.model && chart.source !== "fixture" ? `<span>Read by ${esc(chart.model)}${chart.backend === "cloud" ? " on Google Cloud" : ""}</span>` : ""}${chart.source_note ? `<span>${esc(chart.source_note)}</span>` : ""}</p>
      </div>
      ${ok ? `<div class="view-toggle" role="group" aria-label="View" aria-describedby="view-help">
        <button type="button" id="view-listen" aria-pressed="true">Listen</button>
        <button type="button" id="view-verify" aria-pressed="false">Verify</button>
      </div>` : ""}
    </header>
    ${ok ? `<p class="visually-hidden" id="view-help">The listening view is for exploring by ear. The verification view draws the extracted points on the chart for a sighted helper to check.</p>` : ""}
    ${ok && conf.level !== "high" ? `<p class="trust-callout ${esc(conf.level)}">${levelIcon(conf.level)}<span><strong>${esc(conf.message)}</strong> <a href="#conf-title">See why</a></span></p>` : ""}
    ${ok ? retry : ""}
    ${ok ? `
    <div class="chart-layout panel" id="layout">
      <div class="stage-col">
        <div id="player"></div>
        <div id="verify-extra" hidden>${verifyExtra(chart)}</div>
      </div>
      <section class="verify-col" id="verify-panel" aria-labelledby="verify-title" hidden>
        <h2 id="verify-title">Check each point</h2>
        ${verifyTable(chart)}
      </section>
    </div>
    <div class="chart-grid">
      <div class="chart-grid-main">
        <section class="panel" aria-labelledby="summary-title">
          <div class="panel-head"><h2 id="summary-title">Summary</h2>
            <button type="button" class="btn btn-secondary btn-sm" id="read-summary">Read summary</button></div>
          <p id="summary-text" class="summary-text">${esc(chart.summary?.text || "")}</p>
        </section>
        <section class="panel" aria-labelledby="ask-title">
          <div class="panel-head"><h2 id="ask-title">Ask a question</h2></div>
          <form class="ask-form" id="ask-form">
            <label for="question" class="visually-hidden">Your question about this chart</label>
            <input type="text" id="question" name="question" autocomplete="off" maxlength="500" aria-describedby="ask-help" placeholder="Where is the maximum?">
            <button type="submit" class="btn btn-primary">Ask</button>
            <button type="button" class="btn btn-secondary btn-voice" id="ask-voice" hidden>${MIC_SVG}<span class="voice-label">Ask by voice</span></button>
          </form>
          <p id="voice-status" class="voice-status small" hidden></p>
          <p id="ask-help" class="small soft">Answers are calculated from the extracted data, never written freely by the AI.<span id="voice-help" hidden> To ask by voice, press Ask by voice (or <kbd>V</kbd> while the chart has focus) and speak after the rising tone. Your browser turns speech into text (in Chrome, through Google's speech service).</span></p>
          <ul class="suggestions" aria-label="Example questions">${suggestions(chart).map((q) => `<li><button type="button" data-q="${esc(q)}">${esc(q)}</button></li>`).join("")}</ul>
          <ol class="answers" id="answers" reversed></ol>
        </section>
      </div>
      ${confidencePanel(chart)}
    </div>
    <section class="panel" aria-labelledby="data-title" id="data-section"><div class="panel-head"><h2 id="data-title">Data</h2></div>${dataTable(chart)}</section>`
    : `<div class="error-box"><p>${esc(chart.error)}</p></div>${retry}<img class="failed-image" src="${esc(api.chartImage(chart.id))}" alt="The chart image that could not be read.">`}
  </div>`;
  ctx.setTitle(chart.title || "Chart");
  main.querySelector("#retry-chart")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = main.querySelector("#retry-status");
    btn.disabled = true;
    status.textContent = "Reading the chart again. This can take up to a minute while Gemini is busy.";
    announce(status.textContent);
    try {
      const r = await api.retry(chart.id);
      if (r.status === "ok" && !r.retryable) {
        announce(`Read. ${r.level} confidence.`);
        ctx.navigate(location.hash);
        return;
      }
      status.textContent = r.status === "ok" ? `Read, but ${r.message}` : r.error;
    } catch (err) {
      status.textContent = err.message;
    }
    announce(status.textContent, { urgent: true });
    btn.disabled = false;
  });
  if (!ok) return;

  let lastRows = [];
  const player = new ChartPlayer(main.querySelector("#player"), chart, {
    imageUrl: api.chartImage(chart.id),
    caption: `Chart image from page ${chart.page} of ${chart.document.filename}.`,
    onAsk: canListen() ? () => voice?.toggle() : null,
    onPoint: (si, pi) => {
      lastRows.forEach((r) => r.classList.remove("current"));
      lastRows = [...main.querySelectorAll(`tr[data-s="${si}"][data-p="${pi}"]`)];
      lastRows.forEach((r) => r.classList.add("current"));
    },
  });

  // Listen / Verify toggle
  const listenBtn = main.querySelector("#view-listen");
  const verifyBtn = main.querySelector("#view-verify");
  function setView(verify) {
    listenBtn.setAttribute("aria-pressed", String(!verify));
    verifyBtn.setAttribute("aria-pressed", String(verify));
    main.querySelector("#layout").classList.toggle("verify", verify);
    main.querySelector("#verify-panel").hidden = !verify;
    main.querySelector("#verify-extra").hidden = !verify;
    main.querySelector("#data-section").hidden = verify;
    player.drawMarks(verify);
    announce(verify ? "Verification view. Extracted points are drawn on the chart and listed with their checks." : "Listening view.");
  }
  listenBtn.addEventListener("click", () => setView(false));
  verifyBtn.addEventListener("click", () => setView(true));
  main.querySelector("#read-confidence").addEventListener("click", () => player.readConfidence());

  main.querySelector("#read-summary").addEventListener("click", () => player.readSummary());

  const form = main.querySelector("#ask-form");
  const input = main.querySelector("#question");
  const answers = main.querySelector("#answers");
  async function ask(q, { spoken = false } = {}) {
    q = q.trim();
    if (!q) { input.focus(); announce("Type a question first."); return; }
    if (voice?.listening) voice.abort();
    const btn = form.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      const a = await api.ask(chart.id, q, null);
      answers.insertAdjacentHTML("afterbegin", answerItem(a));
      const conf = a.answerable && a.confidence !== "high" ? ` ${LEVEL_TEXT[a.confidence]}. ${a.confidence_note}` : "";
      // A spoken question is repeated first, so a misheard question is noticed.
      announce(`${spoken ? `You asked: ${q}. ` : ""}${a.answer}${conf}`);
      input.value = "";
    } catch (e) {
      answers.insertAdjacentHTML("afterbegin", `<li><span class="q">You asked: ${esc(q)}</span><span class="a">${esc(e.message)}</span></li>`);
      announce(`${spoken ? `You asked: ${q}. ` : ""}${e.message}`, { urgent: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "Ask";
    }
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
  main.querySelector(".suggestions").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-q]");
    if (b) ask(b.dataset.q);
  });

  // Ask by voice
  const voiceBtn = main.querySelector("#ask-voice");
  const voiceStatus = main.querySelector("#voice-status");
  let voice = null;
  if (canListen()) {
    voiceBtn.hidden = false;
    main.querySelector("#voice-help").hidden = false;
    const label = voiceBtn.querySelector(".voice-label");
    voice = new VoiceInput({
      sound: player.sound,
      onOpening: () => {
        voiceBtn.classList.add("listening");
        label.textContent = "Stop listening";
        voiceStatus.hidden = false;
        voiceStatus.textContent = "Starting the microphone. Speak after the tone.";
      },
      onStart: () => { voiceStatus.textContent = "Listening. Speak your question."; },
      onInterim: (text) => { input.value = text; },
      onEnd: () => {
        voiceBtn.classList.remove("listening");
        label.textContent = "Ask by voice";
        voiceStatus.hidden = true;
      },
      onFinal: (text) => { input.value = text; ask(text, { spoken: true }); },
      onError: (msg) => {
        voiceStatus.hidden = false;
        voiceStatus.textContent = msg;
        announce(msg, { urgent: true });
      },
    });
    voiceBtn.addEventListener("click", () => {
      player.pause({ silent: true });
      voice.toggle();
    });
  }

  return () => { voice?.abort(); player.destroy(); };
}
