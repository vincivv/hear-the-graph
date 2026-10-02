// Processing and document screen: live pipeline steps, then the list of charts.

import { api, watchDocument } from "../api.js";
import { announce } from "../announce.js";
import { esc, levelBadge, typeName, reducedMotion } from "../util.js";

const ICONS = {
  pending: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" opacity="0.6"/></svg>`,
  running: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25"/><path class="spin" d="M12 3 a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  done: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 12.5 l3.2 3.2 L17 9" fill="none" stroke="var(--surface)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  failed: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L22 20 L2 20 Z" fill="var(--low)"/><path d="M12 9 v5 M12 16.5 v0.5" stroke="var(--surface)" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  skipped: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12 h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/></svg>`,
};
const STATUS_WORD = { pending: "waiting", running: "in progress", done: "done", failed: "failed", skipped: "skipped" };

function describe(c) {
  const what = c.n_series > 1 ? `${c.n_series} series, ${c.n_points} points` : `${c.n_points} points`;
  return c.level === "high" ? `${what}.` : `${what}. ${c.message}`;
}

function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} and ${items[items.length - 1]}`;
}

export async function renderDocument(ctx, id) {
  const { main, navigate } = ctx;
  main.innerHTML = `
    <div class="container app-page">
      <a class="back" href="#/app">All files</a>
      <header class="page-head">
        <h1 id="doc-title">Reading your file</h1>
        <p class="meta" id="doc-meta"></p>
      </header>
      <div class="doc-grid">
        <section class="panel" aria-labelledby="steps-title">
          <div class="panel-head"><h2 id="steps-title">Progress</h2></div>
          <ol class="steps" id="steps"></ol>
        </section>
        <div class="doc-main">
          <div id="doc-error" role="alert"></div>
          <section class="panel" aria-labelledby="charts-title" id="charts-section" hidden>
            <div class="panel-head"><h2 id="charts-title">Charts found</h2></div>
            <ul class="chart-list" id="chart-list"></ul>
            <p id="empty-pages" class="small soft"></p>
          </section>
          <section class="panel panel-quiet" aria-labelledby="files-title">
            <div class="panel-head"><h2 id="files-title">Your files</h2></div>
            <p id="expiry">Files are deleted automatically after the session time limit.</p>
            <button type="button" class="btn btn-danger" id="delete-doc">Delete my files now</button>
            <div id="delete-status" role="status"></div>
          </section>
        </div>
      </div>
    </div>`;
  ctx.setTitle("Reading your file");

  const stepsEl = main.querySelector("#steps");
  const lastStatus = {};
  let announcedDone = false;
  let titled = false;

  function paint(d) {
    if (!titled && d.filename) {
      main.querySelector("#doc-title").textContent = d.status === "done" ? d.filename : `Reading ${d.filename}`;
      document.title = `${d.filename} · Hear the Graph`;
    }
    const pages = d.pages ? `${d.pages} page${d.pages === 1 ? "" : "s"}` : "";
    main.querySelector("#doc-meta").innerHTML = [d.kind === "pdf" ? "PDF" : "Image", pages, d.mode === "fixture" ? "Fixture data" : ""]
      .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
    const mins = Math.max(0, Math.round((d.expires_at * 1000 - Date.now()) / 60000));
    main.querySelector("#expiry").textContent = `Your file and its charts are deleted automatically in about ${mins} minute${mins === 1 ? "" : "s"}.`;

    stepsEl.innerHTML = d.steps.map((s) => `
      <li class="${s.status}">
        ${ICONS[s.status] || ICONS.pending}
        <span><span class="label">${esc(s.label)}</span><span class="visually-hidden">, ${STATUS_WORD[s.status]}</span>
        ${s.detail ? `<span class="detail">${esc(s.detail)}</span>` : ""}</span>
      </li>`).join("");
    if (reducedMotion()) stepsEl.querySelectorAll(".spin").forEach((n) => n.classList.remove("spin"));

    // Announce steps as they start and finish (one message per update), not every detail change.
    const msgs = [];
    let urgent = false;
    let startedOne = false;
    for (const s of d.steps) {
      if (lastStatus[s.key] !== s.status) {
        if (s.status === "done" && s.key === "detect") msgs.push(s.detail ? `${s.detail}.` : "Charts found.");
        if (s.status === "running" && lastStatus[s.key] !== undefined && !startedOne) { msgs.push(`${s.label}.`); startedOne = true; }
        if (s.status === "failed") { msgs.push(`${s.label} failed.`); urgent = true; }
        lastStatus[s.key] = s.status;
      }
    }
    if (msgs.length && d.status !== "done" && d.status !== "failed") announce(msgs.join(" "), { urgent });

    if (d.status === "done" || d.status === "failed") {
      titled = true;
      main.querySelector("#doc-title").textContent = d.filename;
      const err = main.querySelector("#doc-error");
      if (d.error) err.innerHTML = `<div class="error-box"><p>${esc(d.error)}</p></div>`;
      const section = main.querySelector("#charts-section");
      if (d.charts.length) {
        section.hidden = false;
        main.querySelector("#charts-title").textContent = d.charts.length === 1 ? "1 chart found" : `${d.charts.length} charts found`;
        main.querySelector("#chart-list").innerHTML = d.charts.map((c) => `
          <li><a href="#/chart/${esc(c.id)}">
            <img class="thumb" src="${esc(api.chartImage(c.id))}" alt="">
            <span><span class="title">Page ${c.page}, ${esc(typeName(c.chart_type).toLowerCase())}: ${esc(c.title || "Untitled chart")}</span>
            <span class="sub">${c.status === "ok" ? esc(describe(c)) : esc(c.error)}</span></span>
            <span class="level-cell">${c.status === "ok" ? levelBadge(c.level) : `<span class="level low">Could not read</span>`}</span>
          </a>${c.retryable && d.mode === "live" ? `
          <div class="retry-row">
            <button type="button" class="btn btn-secondary btn-sm" data-retry="${esc(c.id)}"
              aria-label="Try again: page ${c.page}, ${esc(c.title || "untitled chart")}">Try again</button>
            <span class="small soft" role="status"></span>
          </div>` : ""}</li>`).join("");
      }
      if (d.kind === "pdf" && d.pages > 1) {
        const withCharts = new Set(d.charts.map((c) => c.page));
        const empty = Array.from({ length: d.pages }, (_, i) => i + 1).filter((n) => !withCharts.has(n));
        main.querySelector("#empty-pages").textContent = empty.length
          ? `No charts on page${empty.length > 1 ? "s" : ""} ${listWords(empty.map(String))}.` : "";
      }
      if (!announcedDone) {
        announcedDone = true;
        if (d.status === "failed") {
          announce(d.error || "Processing failed.", { urgent: true });
        } else if (d.charts.length === 1 && d.charts[0].status === "ok" && d.kind === "image") {
          announce("Done. Opening the chart.");
          setTimeout(() => navigate(`#/chart/${d.charts[0].id}`), 700);
        } else if (d.charts.length) {
          const parts = d.charts.map((c) => `page ${c.page}, ${typeName(c.chart_type).toLowerCase()}: ${c.title || "untitled"}, ${c.status === "ok" ? c.level + " confidence" : "could not be read"}`);
          announce(`Done. ${d.charts.length} chart${d.charts.length === 1 ? "" : "s"} found: ${parts.join("; ")}.`);
          main.querySelector("#charts-title").setAttribute("tabindex", "-1");
          main.querySelector("#charts-title").focus();
        } else {
          announce(d.error || "No charts were found.");
        }
      }
    }
  }

  const stop = watchDocument(id, paint, (e) => {
    main.querySelector("#doc-error").innerHTML = `<div class="error-box"><p>${esc(e.message)}</p><p><a href="#/app">Go back</a> to upload the file again.</p></div>`;
  });

  // Charts Gemini was too busy to read can be read again; readings that worked come from the cache.
  main.querySelector("#chart-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-retry]");
    if (!btn) return;
    const status = btn.nextElementSibling;
    btn.disabled = true;
    status.textContent = "Reading again. This can take up to a minute while Gemini is busy.";
    announce(status.textContent);
    try {
      const r = await api.retry(btn.dataset.retry);
      const d = await api.document(id);
      paint(d);
      const msg = r.status === "ok"
        ? `Read: ${r.level} confidence.${r.retryable ? " The second reading was still skipped, so you can try again." : ""}`
        : r.error;
      announce(msg, { urgent: r.status !== "ok" });
      const again = main.querySelector(`button[data-retry="${CSS.escape(r.id)}"]`);
      if (again) { again.nextElementSibling.textContent = msg; again.focus(); }
      else main.querySelector(`a[href="#/chart/${CSS.escape(r.id)}"]`)?.focus();
    } catch (err) {
      status.textContent = err.message;
      announce(err.message, { urgent: true });
      btn.disabled = false;
    }
  });

  main.querySelector("#delete-doc").addEventListener("click", async () => {
    const status = main.querySelector("#delete-status");
    try {
      await api.deleteDocument(id);
      stop();
      status.textContent = "Your file and everything made from it were deleted.";
      announce("Your file and everything made from it were deleted.");
      main.querySelector("#charts-section").hidden = true;
      main.querySelector("#delete-doc").disabled = true;
    } catch (e) {
      status.textContent = e.message;
    }
  });

  return stop;
}
