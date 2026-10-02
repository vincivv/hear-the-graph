// Landing page: what Hear the Graph is, how it works, and why to trust it.
// The app itself lives at #/app.

import { announce } from "../announce.js";
import { ChartPlayer } from "../player.js";

const I = {
  upload: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 15l3-4 3 2 4-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ear: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 9.5a2 2 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".14"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cross: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".12"/><path d="M8.5 8.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  sanity: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20V4m0 16h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 7h16" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 3"/><circle cx="10" cy="12" r="1.8" fill="currentColor"/><circle cx="15" cy="9.5" r="1.8" fill="currentColor"/></svg>`,
  twice: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 9a7 7 0 0 1 12.5-3M19 15a7 7 0 0 1-12.5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17.5 2.5v3.5H14M6.5 21.5V18H10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pixel: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l5-6 4 3 6-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="14" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 17l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  risk: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l9.5 17h-19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
};

const SHAPE = {
  high: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg>`,
  medium: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L19 18 L1 18 Z" fill="currentColor"/></svg>`,
  low: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 L18.5 10 L10 18.5 L1.5 10 Z" fill="none" stroke="currentColor" stroke-width="2.5"/><text x="10" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">?</text></svg>`,
};

const FAQ = [
  ["Does it work with my screen reader?",
   "It is built to. Everything the app says goes through ARIA live regions, the standard way a web page speaks to screen readers such as VoiceOver, NVDA and JAWS, and it passes automated WCAG checks. It has not yet been tested with screen reader users, so some wording or pacing may still need work. Single-key shortcuts only work while the chart has focus, so they do not clash with your screen reader's own keys. A built-in voice is available for people who don't use a screen reader, and it is off by default."],
  ["Which charts can it read?",
   "Line charts and bar charts, with one or several series, on linear or logarithmic axes, from PDFs and from PNG, JPG or WEBP images. Digital charts work best. Photos of slides and charts with few labels are read too, but get lower confidence."],
  ["How accurate is it?",
   "In the first live tests on clean digital charts, the values it read were within a fraction of a percent of the true values. Accuracy drops on tilted photos and on charts without point markers or with very few tick labels, and the app tells you when that happens instead of hiding it."],
  ["Is the AI making up the numbers?",
   "No number you hear comes from free-written AI text. Gemini reads the chart into structured data and picks which calculation answers your question; code computes every value and writes every sentence. If the data can't answer a question, the app says so."],
  ["What happens to my files?",
   "There are no accounts. Files are kept in a temporary folder while you work and deleted after 60 minutes, or straight away when you choose \"Delete my files now\". Course materials are processed for your personal accessibility use only."],
];

export async function renderLanding(ctx) {
  const { main } = ctx;
  main.classList.add("main-landing");
  main.innerHTML = `
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="kicker"><span class="kicker-dot" aria-hidden="true"></span>For blind and low-vision STEM students</p>
        <h1 id="hero-title">Hear every graph in your lecture slides.</h1>
        <p class="hero-lede">Hear the Graph turns charts into sound you can explore point by point, answers your questions with calculated values, and tells you plainly when the numbers can't be trusted.</p>
        <div class="hero-actions">
          <a class="btn btn-signal btn-lg" href="#/app">Open the app</a>
          <button type="button" class="btn btn-on-dark btn-lg" id="hero-listen">Play the example</button>
        </div>
        <ul class="hero-points">
          <li>${I.check}<span>No account needed</span></li>
          <li>${I.check}<span>Built for screen readers and keyboard</span></li>
          <li>${I.check}<span>Files deleted after 60 minutes</span></li>
        </ul>
      </div>
      <div class="hero-visual">
        <div class="mock-window">
          <div class="mock-bar">
            <span class="mock-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="mock-title">Lecture 7 · Page 2</span>
          </div>
          <div class="mock-body" id="hero-player"><p class="soft">Loading the example chart…</p></div>
        </div>
        <div class="float-card float-ask" aria-hidden="true">
          <span class="float-q">Where is the maximum?</span>
          <span class="float-a">45 mol/s at step 7.</span>
        </div>
        <div class="float-card float-trust" aria-hidden="true">
          <span class="float-k">Trust check</span>
          <span class="float-v">${SHAPE.high} 13 of 13 points verified</span>
        </div>
      </div>
    </div>
  </section>

  <section class="stats" aria-label="At a glance">
    <div class="container">
      <ul class="stats-grid">
        <li><strong>2</strong><span>independent readings of every chart</span></li>
        <li><strong>4</strong><span>trust checks before you hear a number</span></li>
        <li><strong>0</strong><span>accessibility violations in automated WCAG 2.2 AA checks</span></li>
        <li><strong>60 min</strong><span>until your files are deleted, or sooner if you choose</span></li>
      </ul>
    </div>
  </section>

  <section class="section" aria-labelledby="problem-title">
    <div class="container narrow-head">
      <h2 id="problem-title">Screen readers describe charts. They can't let you explore them.</h2>
      <p class="section-lede">AI image descriptions give you a few sentences. You can't check a value, you can't follow the line, and you never find out when the description is wrong. For someone who can't see the chart, a confident wrong number is worse than no number.</p>
    </div>
    <div class="container compare">
      <div class="compare-col compare-old">
        <h3>An AI description</h3>
        <ul>
          <li>${I.cross}<span>"A line graph showing reaction rate rising and falling."</span></li>
          <li>${I.cross}<span>No way to step through exact values</span></li>
          <li>${I.cross}<span>Numbers may be invented, and nothing tells you</span></li>
          <li>${I.cross}<span>Questions answered from memory, not from the data</span></li>
        </ul>
      </div>
      <div class="compare-col compare-new">
        <h3>Hear the Graph</h3>
        <ul>
          <li>${I.check}<span>Hear the whole shape: pitch follows the value, sound moves left to right</span></li>
          <li>${I.check}<span>Step through every point with the arrow keys, each value spoken</span></li>
          <li>${I.check}<span>Every chart read twice and checked against its own pixels</span></li>
          <li>${I.check}<span>Answers calculated from the data, with their confidence</span></li>
        </ul>
      </div>
    </div>
  </section>

  <section class="section section-alt" id="how-it-works" aria-labelledby="how-title">
    <div class="container narrow-head">
      <h2 id="how-title">How it works</h2>
      <p class="section-lede">From a lecture PDF to a graph you can hear, in three steps.</p>
    </div>
    <ol class="container steps-row">
      <li class="step-card">
        <span class="step-num" aria-hidden="true">1</span>
        <span class="step-icon">${I.upload}</span>
        <h3>Upload your slides</h3>
        <p>Drop in a PDF or a photo of a slide. Every chart on every page is found and listed by page, type and title.</p>
      </li>
      <li class="step-card">
        <span class="step-num" aria-hidden="true">2</span>
        <span class="step-icon">${I.scan}</span>
        <h3>Read twice, then verified</h3>
        <p>Gemini reads the values, then separately reports where each point sits. Code converts those positions to values, compares the two, and checks every point against the image.</p>
      </li>
      <li class="step-card">
        <span class="step-num" aria-hidden="true">3</span>
        <span class="step-icon">${I.ear}</span>
        <h3>Listen, explore, ask</h3>
        <p>Play the graph as sound, step through the values with the keyboard, read the summary, and ask questions in plain language.</p>
      </li>
    </ol>
  </section>

  <section class="section" id="features" aria-labelledby="features-title">
    <div class="container narrow-head">
      <h2 id="features-title">Everything you need to understand a chart by ear</h2>
      <p class="section-lede">Designed with the conventions of audio graphs, so it feels familiar from the first sound.</p>
    </div>
    <div class="container bento">
      <article class="tile tile-hero">
        <div class="tile-copy">
          <h3>Hear the shape</h3>
          <p>A sweep plays the graph from left to right. Higher pitch means a higher value, and the sound pans from your left ear to your right. A yellow playhead moves across the chart in sync, so a sighted helper can follow along.</p>
        </div>
        <div class="tile-art art-wave" aria-hidden="true">
          <svg viewBox="0 0 400 160" preserveAspectRatio="none">
            <defs><linearGradient id="wavefill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
            <path d="M0 140 C40 138 60 132 90 115 C120 95 140 40 180 22 C220 8 240 40 270 80 C300 118 330 132 400 136 L400 160 L0 160 Z" fill="url(#wavefill)"/>
            <path d="M0 140 C40 138 60 132 90 115 C120 95 140 40 180 22 C220 8 240 40 270 80 C300 118 330 132 400 136" fill="none" stroke="currentColor" stroke-width="3"/>
            <g class="art-playhead"><line x1="0" x2="0" y1="0" y2="160" stroke="#12143A" stroke-width="6"/><line x1="0" x2="0" y1="0" y2="160" stroke="#FFC72C" stroke-width="3.5"/></g>
          </svg>
          <div class="art-bars">${Array.from({ length: 28 }, (_, i) => `<i style="--h:${(Math.round(30 + 60 * Math.sin((i / 27) * Math.PI) ** 2))}%"></i>`).join("")}</div>
        </div>
      </article>
      <article class="tile">
        <h3>Step through exact values</h3>
        <p>Arrow keys move point by point, and each value is spoken. Jump to the maximum, the minimum, the start or the end.</p>
        <div class="art-keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd><kbd>Home</kbd><kbd>End</kbd><kbd>[</kbd><kbd>]</kbd></div>
        <p class="art-readout" aria-hidden="true">Step 7: <strong>45 mol/s</strong></p>
      </article>
      <article class="tile">
        <h3>Ask in plain language</h3>
        <p>"What is the value at 2021?" "Where do the lines cross?" Type it or say it out loud. Gemini picks the calculation; code computes the answer.</p>
        <div class="art-chat" aria-hidden="true">
          <span class="bubble bubble-q">Where is the maximum?</span>
          <span class="bubble bubble-a">45 mol/s, at step 7. High confidence.</span>
        </div>
      </article>
      <article class="tile">
        <h3>Know when not to trust it</h3>
        <p>Every chart gets a confidence level, the reasons, and the regions that are uncertain. Uncertain points are announced as uncertain.</p>
        <ul class="art-levels" aria-hidden="true">
          <li class="lv-high">${SHAPE.high}<span>High</span></li>
          <li class="lv-medium">${SHAPE.medium}<span>Medium</span></li>
          <li class="lv-low">${SHAPE.low}<span>Low</span></li>
        </ul>
      </article>
      <article class="tile">
        <h3>A view for helpers</h3>
        <p>The verification view draws every extracted point on the original image, marked by confidence, beside a table of checks.</p>
        <div class="art-verify" aria-hidden="true">
          <svg viewBox="0 0 200 80"><polyline points="8,70 40,62 72,40 104,14 136,30 168,56 192,64" fill="none" stroke="#d62728" stroke-width="2.5"/>
            <circle cx="40" cy="62" r="5" fill="#136F45" stroke="#fff" stroke-width="2"/><circle cx="72" cy="40" r="5" fill="#136F45" stroke="#fff" stroke-width="2"/>
            <path d="M104 6 L112 14 L104 22 L96 14 Z" fill="#fff" stroke="#B42318" stroke-width="2.5"/><circle cx="136" cy="30" r="5" fill="#136F45" stroke="#fff" stroke-width="2"/></svg>
        </div>
      </article>
      <article class="tile tile-dark">
        <h3>Eyes-closed mode</h3>
        <p>For sighted classmates and teachers: the screen goes dark, the graph plays, then the chart is revealed. A quick way to understand what listening is like.</p>
        <div class="art-blank" aria-hidden="true"><span>Eyes closed. Listen to the graph.</span><i></i></div>
      </article>
    </div>
  </section>

  <section class="section section-night" id="trust" aria-labelledby="trust-title">
    <div class="container narrow-head">
      <h2 id="trust-title">A trust layer, not just a description</h2>
      <p class="section-lede">Before you hear a single number, four independent signals decide how far each value can be trusted.</p>
    </div>
    <div class="container signals">
      <div class="signal">${I.sanity}<h3>Sanity checks</h3><p>Values inside the axis range, points in order, a plausible structure.</p></div>
      <div class="signal">${I.twice}<h3>A second reading</h3><p>Point positions read separately and converted to values in code. Where the two readings disagree, the image decides.</p></div>
      <div class="signal">${I.pixel}<h3>A pixel check</h3><p>Each value is mapped back onto the image. If the line or bar isn't there, the point is flagged.</p></div>
      <div class="signal">${I.risk}<h3>Risk factors</h3><p>Tilted photos, blur, low resolution, missing markers and too few tick labels are detected and named.</p></div>
    </div>
    <div class="container voices">
      <h3 class="voices-title">What you hear</h3>
      <ul class="voice-list">
        <li class="voice voice-high">${SHAPE.high}<div><strong>High</strong><q>High confidence.</q></div></li>
        <li class="voice voice-medium">${SHAPE.medium}<div><strong>Medium</strong><q>The shape is reliable. Exact values may be off by a few percent.</q></div></li>
        <li class="voice voice-low">${SHAPE.low}<div><strong>Low</strong><q>Shape only. Do not rely on exact values. Ask a helper or upload the original file.</q></div></li>
      </ul>
    </div>
  </section>

  <section class="section" id="accessibility" aria-labelledby="a11y-title">
    <div class="container split-feature">
      <div>
        <h2 id="a11y-title">Built for the keyboard and the screen reader first</h2>
        <p class="section-lede">Every part of Hear the Graph can be used from start to finish without sight or a mouse. Accessibility isn't a mode you switch on; it's how the app is made.</p>
        <a class="btn btn-primary" href="#/app">Try it with your screen reader</a>
      </div>
      <ul class="checklist">
        <li>${I.check}<span><strong>Spoken through live regions</strong>, the standard way a page speaks to screen readers.</span></li>
        <li>${I.check}<span><strong>Shortcuts that never clash</strong>: single keys only work while the chart has focus.</span></li>
        <li>${I.check}<span><strong>Never color alone</strong>: confidence uses a shape and a word as well as a color.</span></li>
        <li>${I.check}<span><strong>Typeface made for low vision</strong>: Atkinson Hyperlegible, by the Braille Institute.</span></li>
        <li>${I.check}<span><strong>Light and dark themes</strong>, high contrast, and support for reduced motion.</span></li>
      </ul>
    </div>
  </section>

  <section class="section section-alt" id="faq" aria-labelledby="faq-title">
    <div class="container faq-wrap">
      <div>
        <h2 id="faq-title">Questions</h2>
        <p class="section-lede">Something else on your mind? The app explains its limits on every chart.</p>
      </div>
      <div class="faq">
        ${FAQ.map(([q, a]) => `<details><summary><span>${q}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><p>${a}</p></details>`).join("")}
      </div>
    </div>
  </section>

  <section class="section cta-section" aria-labelledby="cta-title">
    <div class="container">
      <div class="cta-band">
        <div class="hero-glow" aria-hidden="true"></div>
        <h2 id="cta-title">Hear your first graph.</h2>
        <p>Start with a sample lecture, or upload your own slides.</p>
        <a class="btn btn-signal btn-lg" href="#/app">Open the app</a>
      </div>
    </div>
  </section>`;
  ctx.setTitle("");

  // The hero's product window plays a real chart.
  let player = null;
  const holder = main.querySelector("#hero-player");
  try {
    const res = await fetch("/samples/home-chart.json");
    if (!res.ok) throw new Error();
    const chart = await res.json();
    holder.innerHTML = "";
    player = new ChartPlayer(holder, chart, {
      imageUrl: "/samples/reaction_rate.png",
      caption: "Example: reaction rate over 13 temperature steps. Values from the chart's known data.",
      variant: "hero",
    });
  } catch (e) {
    holder.innerHTML = `<p class="soft">The example chart could not be loaded.</p>`;
  }
  main.querySelector("#hero-listen").addEventListener("click", (e) => {
    if (!player) return;
    player.el.play.focus();
    if (!player.playing) player.play({ wait: e.detail === 0 });
    else announce("Already playing.");
  });

  // Gentle reveal for a few blocks as they scroll into view (off under reduced motion).
  let io = null;
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const targets = main.querySelectorAll(".step-card, .tile, .signal, .compare-col");
    targets.forEach((t) => t.classList.add("reveal"));
    io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    targets.forEach((t) => io.observe(t));
  }

  return () => { player?.destroy(); io?.disconnect(); main.classList.remove("main-landing"); };
}
