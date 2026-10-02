// The chart player: the chart image with a yellow playhead that moves in sync
// with the sound, a transport bar, and point-by-point keyboard exploration
// through Chart2Music (which speaks each value into a live region).

import { c2mChart } from "../vendor/chart2music.mjs";
import { Sound, HERTZES, pitchIndex, panFor, getVolume, setVolume } from "./audio.js";
import { announce, announceThen, isVoiceOn, mirrorToVoice } from "./announce.js";
import { esc, chartFormat, reducedMotion, typeName } from "./util.js";

const VOLUME_OPTIONS = [["soft", "Soft"], ["normal", "Normal"], ["loud", "Loud"]];
const SPEEDS = [["0.5", "Half speed"], ["1", "Normal speed"], ["1.5", "1.5 times"], ["2", "Double speed"]];
let uid = 0;

const ICON_PLAY = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>`;
const ICON_PAUSE = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>`;
const ICON_EYE = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12c2.5-4 5.5-6 9-6s6.5 2 9 6c-2.5 4-5.5 6-9 6s-6.5-2-9-6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export function isUncertain(p) { return !!p && (p.flags || []).includes("uncertain"); }

export class ChartPlayer {
  constructor(container, chart, opts = {}) {
    this.chart = chart;
    this.opts = opts;
    this.id = `pl${++uid}`;
    this.sound = new Sound();
    this.si = 0; // series for the sweep
    this.cur = { si: 0, pi: 0 };
    this.progress = 0;
    this.playing = false;
    this.speed = 1;
    this.raf = 0;
    this.fmt = chartFormat(chart);
    this._prepare();
    this._render(container);
    this._initExplorer();
    this._drawPlayhead(null);
    const s0 = chart.series[0];
    const n = chart.series.reduce((a, s) => a + s.points.length, 0);
    this.el.readout.innerHTML = this.opts.variant === "hero"
      ? `<span class="soft">${n} points. Press "Play graph" to listen.</span>`
      : `<span class="soft">${n} points, ${esc(this.fmt.xName.toLowerCase())} ${esc(this.fmt.fx(s0.points[0]))} to ${esc(this.fmt.fx(s0.points[s0.points.length - 1]))}. ${esc(this.scaleText())} Focus the chart and use the arrow keys to step through them.</span>`;
  }

  // ---------- geometry ----------
  _prepare() {
    const c = this.chart;
    const [W, H] = c.image_size?.length ? c.image_size : [1000, 650];
    this.W = W; this.H = H;
    const pa = c.plot_area?.length === 4 ? c.plot_area : [W * 0.1, H * 0.1, W * 0.95, H * 0.88];
    this.plot = pa;
    const ys = c.series.flatMap((s) => s.points.map((p) => p.y));
    const log = c.y_axis.scale === "log" && ys.every((v) => v > 0);
    this.log = log;
    this.ymin = Math.min(c.y_axis.min, ...ys);
    this.ymax = Math.max(c.y_axis.max, ...ys);
    if (log) { this.ymin = Math.max(Math.min(...ys), c.y_axis.min > 0 ? c.y_axis.min : Math.min(...ys)); }
    if (this.ymax === this.ymin) this.ymax = this.ymin + 1;
    const xs = c.series.flatMap((s) => s.points.map((p) => p.x));
    this.xmin = Math.min(...xs);
    this.xmax = Math.max(...xs);
    this.categorical = c.x_axis.scale === "category";
    this.kind = c.chart_type === "bar" ? "bar" : c.chart_type === "scatter" ? "scatter" : "line";
    // Fallback pixel positions when the geometry reading is missing.
    for (const s of c.series) {
      s.points.forEach((p, i) => {
        if (!p.pixel) {
          const fx = this.xmax > this.xmin ? (p.x - this.xmin) / (this.xmax - this.xmin) : i / Math.max(1, s.points.length - 1);
          p.pixel = [pa[0] + fx * (pa[2] - pa[0]), pa[3] - this.pct(p.y) * (pa[3] - pa[1])];
          p._estimated = true;
        }
      });
    }
  }

  /** What the lowest and highest notes stand for: pitch is spread over the y axis. */
  scaleText() {
    const { fy } = this.fmt;
    return `Low notes are ${fy(this.ymin)}, high notes are ${fy(this.ymax)}${this.log ? ", on a logarithmic scale" : ""}.`;
  }

  /**
   * An axis that stops well short of zero makes small changes sound big (49 to 73 fills the whole
   * pitch range). Said once per chart, when it is first played, and in the summary.
   */
  baselineText() {
    if (this.log || this.chart.y_axis.scale === "category") return "";
    const range = this.ymax - this.ymin;
    const { fy } = this.fmt;
    if (this.ymin > 0 && this.ymin > 0.25 * range) return `The axis starts at ${fy(this.ymin)}, not zero, so changes sound bigger than they are.`;
    if (this.ymax < 0 && -this.ymax > 0.25 * range) return `The axis ends at ${fy(this.ymax)}, not zero, so changes sound bigger than they are.`;
    return "";
  }

  pct(y) {
    if (this.log) return (Math.log10(y) - Math.log10(this.ymin)) / (Math.log10(this.ymax) - Math.log10(this.ymin));
    return (y - this.ymin) / (this.ymax - this.ymin);
  }

  plan(si) {
    const s = this.chart.series[si];
    const n = s.points.length;
    const pts = s.points.map((p, i) => {
      let t;
      if (this.kind === "bar" || this.categorical) t = i / n;
      else t = this.xmax > this.xmin ? (p.x - s.points[0].x) / ((s.points[n - 1].x - s.points[0].x) || 1) : i / Math.max(1, n - 1);
      const panT = this.xmax > this.xmin ? (p.x - this.xmin) / (this.xmax - this.xmin) : i / Math.max(1, n - 1);
      return { t, freq: HERTZES[pitchIndex(this.pct(p.y))], pan: panFor(panT), uncertain: isUncertain(p), i };
    });
    return { kind: this.kind === "line" ? "line" : "bar", points: pts };
  }

  baseDuration(si) {
    const n = this.chart.series[si].points.length;
    return Math.max(3.5, Math.min(10, n * 0.33));
  }

  // ---------- DOM ----------
  _render(container) {
    const c = this.chart;
    const multi = c.series.length > 1;
    const hero = this.opts.variant === "hero";
    const id = this.id;
    container.innerHTML = `
      <figure class="stage" aria-labelledby="${id}-cap">
        <div class="stage-frame" id="${id}-stage" role="application" aria-roledescription="chart explorer"
             aria-label="${esc(c.title || "Chart")}, ${esc(typeName(c.chart_type).toLowerCase())}. Use left and right arrows to hear each point. Press P to play the whole graph."
             aria-describedby="${id}-hint">
          <div class="canvas">
            <img src="${esc(this.opts.imageUrl)}" alt="" draggable="false">
            <svg class="overlay" viewBox="0 0 ${this.W} ${this.H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <g class="marks"></g>
              <g class="playhead">
                <line class="playhead-line-edge" x1="0" x2="0" y1="${this.plot[1]}" y2="${this.plot[3]}"/>
                <line class="playhead-line" x1="0" x2="0" y1="${this.plot[1]}" y2="${this.plot[3]}"/>
                <circle class="playhead-dot" cx="0" cy="0" r="${Math.max(7, this.W / 110)}"/>
              </g>
            </svg>
          </div>
        </div>
        <figcaption id="${id}-cap">${esc(this.opts.caption || c.title || "Chart")}</figcaption>
      </figure>
      <div class="visually-hidden" id="${id}-hint">Single-key shortcuts work while the chart has focus. Press H for the full list.</div>
      <div class="visually-hidden" id="${id}-cc"></div>
      <div class="transport${hero ? " transport-hero" : ""}" role="group" aria-label="Player">
        <button type="button" class="btn btn-primary play" id="${id}-play">${ICON_PLAY}<span class="label">Play graph</span></button>
        ${hero ? "" : `<button type="button" class="btn btn-secondary explore-btn" id="${id}-explore">Explore points</button>
        <span class="field"><label for="${id}-speed">Speed</label>
          <select id="${id}-speed">${SPEEDS.map(([v, l]) => `<option value="${v}"${v === "1" ? " selected" : ""}>${l}</option>`).join("")}</select></span>
        <span class="field"><label for="${id}-volume">Volume</label>
          <select id="${id}-volume">${VOLUME_OPTIONS.map(([v, l]) => `<option value="${v}"${v === getVolume() ? " selected" : ""}>${l}</option>`).join("")}</select></span>
        ${multi ? `<span class="field"><label for="${id}-series">Series</label>
          <select id="${id}-series">${c.series.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("")}</select></span>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost eyes-btn" id="${id}-eyes">${ICON_EYE}<span class="label-long">Eyes-closed mode</span><span class="label-short">Eyes closed</span></button>`}
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" id="${id}-fill"></div></div>
      </div>
      <p class="readout" id="${id}-readout"></p>`;
    const $ = (s) => container.querySelector(s);
    this.el = {
      stage: $(`#${id}-stage`), svg: $("svg.overlay"), marks: $("g.marks"), head: $("g.playhead"),
      line: [...container.querySelectorAll(".playhead line")], dot: $(".playhead-dot"),
      play: $(`#${id}-play`), explore: $(`#${id}-explore`), speed: $(`#${id}-speed`), volume: $(`#${id}-volume`), series: $(`#${id}-series`),
      eyes: $(`#${id}-eyes`), fill: $(`#${id}-fill`), readout: $(`#${id}-readout`), cc: $(`#${id}-cc`),
    };
    // detail 0: a keyboard or screen reader activation, not a mouse click (see play()).
    this.el.play.addEventListener("click", (e) => this.toggle({ wait: e.detail === 0 }));
    this.el.explore?.addEventListener("click", () => this.el.stage.focus());
    this.el.speed?.addEventListener("change", () => this.setSpeed(Number(this.el.speed.value)));
    this.el.volume?.addEventListener("change", () => {
      setVolume(this.el.volume.value);
      // A sample note at the new volume (the middle of the range), unless the graph is playing.
      if (!this.playing && this.sound.ensure()) this.sound.note(HERTZES[15], 0, 0.25);
    });
    this.el.series?.addEventListener("change", () => this.setSeries(Number(this.el.series.value), true));
    this.el.eyes?.addEventListener("click", () => this.eyesClosed());
    // Arrow keys on the chart take over from a running sweep.
    this.el.stage.addEventListener("keydown", (e) => {
      if (this.playing && /^(Arrow|Home|End|Page|\[|\])/.test(e.key) && e.key.length > 0 && !(e.key === "p" || e.key === "P")) this.pause();
    }, true);
    this.unmirror = mirrorToVoice(this.el.cc);
  }

  _initExplorer() {
    const c = this.chart;
    const names = [];
    const data = {};
    c.series.forEach((s, si) => {
      let name = s.name || `Series ${si + 1}`;
      while (names.includes(name)) name += " ";
      names.push(name);
      // Chart2Music appends a point's label to what it speaks: "3, 45 mol/s, uncertain".
      data[name] = s.points.map((p, pi) => ({ x: p.x, y: p.y, custom: { si, pi }, ...(isUncertain(p) ? { label: "uncertain" } : {}) }));
    });
    this.seriesNames = names;
    const labelByX = new Map();
    c.series.forEach((s) => s.points.forEach((p) => labelByX.set(p.x, p.x_label)));
    const xUnit = this.categorical ? "" : c.x_axis.unit;
    const fmtX = (v) => {
      const label = this.categorical ? (c.x_axis.categories[Math.round(v)] ?? String(v)) : (labelByX.get(v) ?? String(+v.toFixed(4)));
      return xUnit && !this.categorical ? `${label} ${xUnit}` : label;
    };
    const { fy } = this.fmt;
    const self = this;
    const res = c2mChart({
      type: this.kind,
      element: this.el.stage,
      cc: this.el.cc,
      title: c.title || "",
      data,
      axes: {
        x: { label: c.x_axis.label || "x", minimum: this.xmin, maximum: this.xmax, format: fmtX },
        y: { label: c.y_axis.label || "value", minimum: this.ymin, maximum: this.ymax, format: (v) => fy(v), type: this.log ? "log10" : "linear" },
      },
      audioEngine: this.sound.c2mEngine(() => self._c2mCurrentUncertain()),
      options: {
        hertzes: HERTZES,
        onFocusCallback: ({ point }) => {
          const cu = point?.custom;
          if (cu) self.focusPoint(cu.si, cu.pi, { fromExplorer: true });
        },
        customHotkeys: [
          { key: { key: "p" }, title: "Play or pause the whole graph", callback: () => self.toggle({ wait: true }) },
          { key: { key: "s" }, title: "Read the summary", callback: () => self.readSummary() },
          { key: { key: "c" }, title: "Read the confidence", callback: () => self.readConfidence() },
          ...(self.opts.onAsk ? [{ key: { key: "v" }, title: "Ask a question by voice", callback: () => { self.pause({ silent: true }); self.opts.onAsk(); } }] : []),
        ],
      },
    });
    if (res.err) {
      console.warn("Chart2Music:", res.err);
      this.c2m = null;
    } else {
      this.c2m = res.data;
    }
  }

  _c2mCurrentUncertain() {
    const cu = this.c2m?.getCurrent()?.point?.custom;
    return cu ? isUncertain(this.chart.series[cu.si].points[cu.pi]) : false;
  }

  // ---------- spoken extras ----------
  readSummary() {
    const s = this.chart.summary?.text;
    announce(s ? [s, this.baselineText()].filter(Boolean).join(" ") : "No summary is available for this chart.");
  }

  readConfidence() {
    const conf = this.chart.confidence || {};
    const parts = [conf.message];
    if (conf.reasons?.length) parts.push(conf.reasons.join(" "));
    if (conf.uncertain_regions?.length) parts.push("Uncertain: " + conf.uncertain_regions.map((r) => r.text).join("; ") + ".");
    announce(parts.filter(Boolean).join(" "));
  }

  // ---------- point focus ----------
  pointText(si, pi) {
    const p = this.chart.series[si].points[pi];
    const multi = this.chart.series.length > 1 ? `${this.chart.series[si].name}, ` : "";
    return `${multi}${this.fmt.xName} ${this.fmt.fx(p)}: ${this.fmt.fy(p.y)}`;
  }

  focusPoint(si, pi, { fromExplorer = false } = {}) {
    this.cur = { si, pi };
    if (si !== this.si) this.setSeries(si, false);
    if (this.playing && fromExplorer) this.pause();
    const p = this.chart.series[si].points[pi];
    this._placeHead(p.pixel[0], p.pixel[1], isUncertain(p));
    this.el.readout.innerHTML = `${esc(this.pointText(si, pi))}${isUncertain(p) ? ` <span class="tag level low">uncertain</span>` : ""}`;
    this.opts.onPoint?.(si, pi);
  }

  // ---------- transport ----------
  _playLabel(playing) {
    this.el.play.innerHTML = `${playing ? ICON_PAUSE : ICON_PLAY}<span class="label">${playing ? "Pause" : "Play graph"}</span>`;
    if (playing) this.el.play.setAttribute("aria-label", "Pause graph");
    else this.el.play.removeAttribute("aria-label");
  }

  setSpeed(v) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause({ silent: true });
    this.speed = v;
    if (wasPlaying) this.play({ quiet: true });
  }

  setSeries(si, announceIt) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause({ silent: true });
    this.si = si;
    this.progress = 0;
    if (this.el.series) this.el.series.value = String(si);
    if (announceIt) announce(`Series ${this.chart.series[si].name}.`);
    if (wasPlaying) this.play();
  }

  /** P and the play button: start, pause, or skip the spoken introduction ("Start now"). */
  toggle({ wait = false } = {}) { this.waiting ? this._startSound() : this.playing ? this.pause() : this.play({ wait }); }

  /**
   * Play the graph. Unless `quiet`, what is about to play is announced first ("Playing ... Low
   * notes are ..."), or `intro` if given.
   *
   * The sound waits until that has been said, so speech and sound never overlap, when something
   * is speaking it: the built-in voice (its end is known exactly), or a screen reader, assumed
   * when play came from the keyboard or a screen reader's activate command (`wait`). A page
   * cannot detect a screen reader, so a mouse click starts the sound at once rather than leave
   * a sighted user in silence. While waiting, the play button reads "Start now".
   */
  play({ onEnd = null, quiet = false, intro = "", wait = false } = {}) {
    if (!this.sound.ensure()) { announce("Sound is not available in this browser."); return; }
    if (this.waiting) { this._startSound(); return; } // "Start now"
    if (this.progress >= 0.999) this.progress = 0;
    this.onEnd = onEnd;
    this.playing = true;
    const text = intro || (quiet ? "" : this._introText());
    if (text && (wait || isVoiceOn())) {
      this._waitLabel();
      this.waiting = announceThen(text, () => this._startSound());
      return;
    }
    if (text) announce(text);
    this._startSound();
  }

  _introText() {
    if (this.progress > 0) return "Resuming.";
    const s = this.chart.series[this.si];
    const first = s.points[0], last = s.points[s.points.length - 1];
    const what = this.chart.series.length > 1 ? `${s.name}, ` : "";
    const warn = this.baselineWarned ? "" : this.baselineText();
    this.baselineWarned = true;
    return [`Playing ${what}${this.fmt.xName} ${this.fmt.fx(first)} to ${this.fmt.fx(last)}.`, this.scaleText(), warn].filter(Boolean).join(" ");
  }

  _waitLabel() {
    this.el.play.innerHTML = `${ICON_PLAY}<span class="label">Start now</span>`;
    this.el.play.setAttribute("aria-label", "Start the sound now");
  }

  _startSound() {
    if (this.waiting) { this.waiting(); this.waiting = null; }
    if (!this.playing) return;
    const plan = this.plan(this.si);
    this.planNow = plan;
    const D = this.baseDuration(this.si) / this.speed;
    this.handle = this.sound.sweep(plan, this.progress, D);
    this._playLabel(true);
    const tick = () => {
      if (!this.playing) return;
      const h = this.handle;
      const p = h.from + (this.sound.now - h.t0) / h.duration;
      this.progress = Math.max(h.from, Math.min(1, p));
      this._drawPlayhead(this.progress);
      if (this.sound.now >= h.end) { this._finish(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause({ silent = false } = {}) {
    if (!this.playing) return;
    this.playing = false;
    if (this.waiting) { this.waiting(); this.waiting = null; this._playLabel(false); return; }
    cancelAnimationFrame(this.raf);
    this.sound.stopAll();
    this._playLabel(false);
    if (!silent) announce("Paused.");
  }

  _finish() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.progress = 1;
    this._drawPlayhead(1);
    this._playLabel(false);
    this.progress = 0;
    const cb = this.onEnd;
    this.onEnd = null;
    if (cb) cb(); else announce("End of graph.");
  }

  // ---------- playhead ----------
  _placeHead(x, y, uncertain) {
    for (const l of this.el.line) { l.setAttribute("x1", x); l.setAttribute("x2", x); }
    this.el.dot.setAttribute("cx", x);
    this.el.dot.setAttribute("cy", y);
    this.el.head.classList.add("on");
    this.el.head.classList.toggle("uncertain", !!uncertain);
  }

  _drawPlayhead(progress) {
    if (progress === null) { this.el.head.classList.remove("on"); this.el.fill.style.width = "0"; return; }
    this.el.fill.style.width = `${(progress * 100).toFixed(2)}%`;
    const plan = this.planNow || this.plan(this.si);
    const s = this.chart.series[this.si];
    const pts = plan.points;
    let k = 0;
    while (k + 1 < pts.length && pts[k + 1].t <= progress + 1e-9) k++;
    const a = s.points[pts[k].i];
    // Bars sound as separate notes, so the playhead steps from bar to bar.
    if (plan.kind === "bar" || reducedMotion() || k + 1 >= pts.length || progress < pts[0].t) {
      this._placeHead(a.pixel[0], a.pixel[1], isUncertain(a));
    } else {
      const b = s.points[pts[k + 1].i];
      const u = (progress - pts[k].t) / ((pts[k + 1].t - pts[k].t) || 1);
      const x = a.pixel[0] + (b.pixel[0] - a.pixel[0]) * u;
      const y = plan.kind === "line" ? a.pixel[1] + (b.pixel[1] - a.pixel[1]) * u : a.pixel[1];
      this._placeHead(x, y, isUncertain(a));
    }
    if (this._lastK !== k) {
      this._lastK = k;
      this.el.readout.innerHTML = `${esc(this.pointText(this.si, pts[k].i))}${isUncertain(a) ? ` <span class="tag level low">uncertain</span>` : ""}`;
      this.opts.onPoint?.(this.si, pts[k].i);
    }
  }

  // ---------- eyes-closed mode ----------
  eyesClosed() {
    const back = document.activeElement;
    const ov = document.createElement("div");
    ov.className = "eyes-closed";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", `${this.id}-ec`);
    ov.innerHTML = `
      <p id="${this.id}-ec">Eyes closed. Listen to the graph.</p>
      <div class="bar" aria-hidden="true"><div></div></div>
      <button type="button" class="primary">Stop and show the chart</button>`;
    document.body.appendChild(ov);
    // Everything behind the overlay is inert while it is open.
    const behind = [...document.body.children].filter((n) => n !== ov && !n.matches("#announcer, #announcer-assertive, script"));
    behind.forEach((n) => { n.inert = true; });
    const btn = ov.querySelector("button");
    const bar = ov.querySelector(".bar div");
    const msg = ov.querySelector("p");
    btn.focus();
    let barRaf = 0;
    const reveal = () => {
      cancelAnimationFrame(barRaf);
      this.pause({ silent: true });
      ov.remove();
      behind.forEach((n) => { n.inert = false; });
      document.removeEventListener("keydown", onKey, true);
      this.el.stage.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      announce("Here is the graph you heard.");
      (back && back.isConnected ? back : this.el.play).focus();
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); reveal(); } };
    document.addEventListener("keydown", onKey, true);
    btn.addEventListener("click", reveal);
    this.progress = 0;
    this.play({
      intro: "Eyes-closed mode. The screen is blank. Listen to the graph. Press Escape to stop.",
      wait: true, // only sound follows, so the introduction is always heard first
      onEnd: () => {
        cancelAnimationFrame(barRaf);
        bar.style.width = "100%";
        msg.textContent = "That was the graph. Ready to see it?";
        btn.textContent = "Reveal the chart";
        announce("That was the graph. Press Reveal the chart to see it.");
        btn.focus();
      },
    });
    const barTick = () => { bar.style.width = `${(this.progress * 100).toFixed(1)}%`; if (this.playing) barRaf = requestAnimationFrame(barTick); };
    barRaf = requestAnimationFrame(barTick);
  }

  // ---------- verification marks ----------
  drawMarks(show) {
    const g = this.el.marks;
    if (!show) { g.innerHTML = ""; return; }
    const r = Math.max(6, this.W / 120);
    let out = "";
    this.chart.series.forEach((s, si) => s.points.forEach((p, pi) => {
      const [x, y] = p.pixel;
      const lvl = p.confidence >= 0.85 ? "high" : p.confidence >= 0.7 && !isUncertain(p) ? "medium" : "low";
      const cls = `mark ${lvl}`;
      const id = `data-s="${si}" data-p="${pi}"`;
      if (lvl === "high") out += `<circle class="${cls}" ${id} cx="${x}" cy="${y}" r="${r}"/>`;
      else if (lvl === "medium") out += `<path class="${cls}" ${id} d="M${x} ${y - r * 1.25} L${x + r * 1.15} ${y + r * 0.8} L${x - r * 1.15} ${y + r * 0.8} Z"/>`;
      else out += `<path class="${cls}" ${id} d="M${x} ${y - r * 1.3} L${x + r * 1.3} ${y} L${x} ${y + r * 1.3} L${x - r * 1.3} ${y} Z"/><text class="mark-label" x="${x + r * 1.6}" y="${y - r * 0.6}">?</text>`;
    }));
    g.innerHTML = out;
  }

  destroy() {
    this.pause({ silent: true });
    cancelAnimationFrame(this.raf);
    try { this.c2m?.cleanUp(); } catch (e) { /* ignore */ }
    this.unmirror?.();
    document.querySelectorAll(".eyes-closed").forEach((n) => n.remove());
    document.querySelectorAll("[inert]").forEach((n) => { n.inert = false; });
  }
}
