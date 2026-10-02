// App start (#/app): upload or pick a sample, with an example chart to try first.

import { api } from "../api.js";
import { announce } from "../announce.js";
import { esc } from "../util.js";
import { uploadSection, wireUpload } from "./upload.js";
import { ChartPlayer } from "../player.js";

const SAMPLE_THUMBS = { lecture: "/samples/lecture-thumb.png" };
const HARD = new Set(["sparse-ticks", "phone-photo"]);

export async function renderHome(ctx) {
  const { main, navigate, health } = ctx;
  main.innerHTML = `
    <div class="container app-page">
      <header class="page-head">
        <h1>Open a chart</h1>
        <p class="lede">Upload a lecture PDF or an image of a chart, or start with one of the samples.</p>
      </header>

      <div class="app-start">
        ${uploadSection(health)}

        <section class="panel" aria-labelledby="samples-title">
          <div class="panel-head">
            <h2 id="samples-title">Samples</h2>
            <p class="small soft">Each sample runs the full pipeline. The two marked "Hard case" show the app warning you not to trust the exact values.</p>
          </div>
          <ul class="samples" id="samples"><li><p class="soft">Loading samples…</p></li></ul>
          <div id="sample-error" role="alert"></div>
        </section>
      </div>

      <section class="panel example-panel" aria-labelledby="example-title">
        <div class="panel-head">
          <h2 id="example-title">Try the player first</h2>
          <p class="small soft">Press "Play graph", or tab to the chart and use the arrow keys. No upload needed.</p>
        </div>
        <div id="home-player"><p class="soft">Loading the example chart…</p></div>
      </section>
    </div>`;
  ctx.setTitle("Open a chart");

  wireUpload(main, navigate, health);

  const list = main.querySelector("#samples");
  try {
    const samples = await api.samples();
    list.innerHTML = samples.map((s) => {
      const [kind, ...rest] = s.label.split(": ");
      const title = rest.length ? rest.join(": ") : s.label;
      const tag = HARD.has(s.name) ? `<span class="tag tag-hard">Hard case</span>` : `<span class="tag">${s.kind === "pdf" ? "PDF" : "Image"}</span>`;
      return `
      <li><button type="button" data-sample="${esc(s.name)}">
        <img class="thumb" src="${esc(SAMPLE_THUMBS[s.name] || `/samples/${s.file}`)}" alt="">
        <span class="sample-text"><span class="label">${esc(title[0].toUpperCase() + title.slice(1))}</span>
          <span class="kind">${esc(rest.length ? kind : s.file)}</span></span>
        ${tag}
      </button></li>`;
    }).join("");
    list.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-sample]");
      if (!b) return;
      b.disabled = true;
      announce("Starting the sample.");
      try {
        const { id } = await api.startSample(b.dataset.sample);
        navigate(`#/doc/${id}`);
      } catch (err) {
        b.disabled = false;
        main.querySelector("#sample-error").innerHTML = `<div class="error-box"><p>${esc(err.message)}</p></div>`;
      }
    });
  } catch (e) {
    list.innerHTML = `<li><div class="error-box"><p>${esc(e.message)}</p></div></li>`;
  }

  let player = null;
  const holder = main.querySelector("#home-player");
  try {
    const res = await fetch("/samples/home-chart.json");
    if (!res.ok) throw new Error();
    const chart = await res.json();
    holder.innerHTML = "";
    player = new ChartPlayer(holder, chart, {
      imageUrl: "/samples/reaction_rate.png",
      caption: `${chart.title}. Example values come from the chart's known data, not a live reading.`,
    });
  } catch (e) {
    holder.innerHTML = `<p class="soft">The example chart could not be loaded. Try a sample instead.</p>`;
  }
  return () => player?.destroy();
}
