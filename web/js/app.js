// App shell: hash router, header settings, mode banner, shortcuts dialog.

import { api } from "./api.js";
import { announce, isVoiceOn, setVoice } from "./announce.js";
import { renderHome } from "./views/home.js";
import { renderLanding } from "./views/landing.js";
import { renderDocument } from "./views/document.js";
import { renderChart } from "./views/chart.js";

const main = document.getElementById("main");
let cleanup = null;
export const appState = { health: null };

// ---------- Theme ----------
const THEMES = ["system", "light", "dark"];
const THEME_ICON = {
  system: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>`,
  light: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  dark: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
};
function currentTheme() {
  try { return localStorage.getItem("theme") || "system"; } catch (e) { return "system"; }
}
function applyTheme(t) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) { /* ignore */ }
  const b = document.getElementById("theme-button");
  b.innerHTML = THEME_ICON[t];
  b.title = `Theme: ${t}`;
  b.setAttribute("aria-label", `Theme: ${t}. Change theme`);
}
document.getElementById("theme-button").addEventListener("click", () => {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  applyTheme(next);
  announce(next === "system" ? "Theme follows your system setting." : `${next[0].toUpperCase() + next.slice(1)} theme.`);
});
applyTheme(currentTheme());

// ---------- Voice ----------
const voiceBtn = document.getElementById("voice-button");
function paintVoice() {
  const on = isVoiceOn();
  voiceBtn.setAttribute("aria-pressed", String(on));
  voiceBtn.innerHTML = `<span class="label-long">Built-in voice: ${on ? "on" : "off"}</span><span class="label-short">Voice: ${on ? "on" : "off"}</span>`;
}
if (!("speechSynthesis" in window)) voiceBtn.hidden = true;
voiceBtn.addEventListener("click", () => {
  setVoice(!isVoiceOn());
  paintVoice();
  announce(isVoiceOn() ? "Built-in voice on. Turn it off if you use a screen reader." : "Built-in voice off.");
});
paintVoice();

// ---------- Shortcuts dialog ----------
const dlg = document.getElementById("shortcuts-dialog");
let shortcutsReturn = null;
export function openShortcuts() {
  shortcutsReturn = document.activeElement;
  dlg.showModal();
}
document.getElementById("shortcuts-button").addEventListener("click", openShortcuts);
dlg.addEventListener("close", () => { shortcutsReturn?.focus?.(); });

// ---------- Mode banner ----------
async function loadHealth() {
  try {
    const h = await api.health();
    appState.health = h;
    document.getElementById("ttl").textContent = h.session_ttl_minutes;
    document.getElementById("backend-status").textContent = h.mode === "live"
      ? `This server reads charts with ${h.backend_label}, model ${h.model}.`
      : "This server is in fixture mode and makes no Gemini calls.";
    const banner = document.getElementById("mode-banner");
    if (h.mode === "fixture") {
      document.getElementById("mode-banner-title").textContent = "Fixture mode.";
      document.getElementById("mode-banner-text").textContent =
        `Numbers come from the answer key for the built-in test charts, not from Gemini. ${h.mode_note || ""} Add a Gemini API key or Google Cloud credentials to read your own files.`;
      banner.hidden = false;
    } else if (h.mode_note) {
      document.getElementById("mode-banner-title").textContent = "Note.";
      document.getElementById("mode-banner-text").textContent = h.mode_note;
      banner.hidden = false;
    }
  } catch (e) { /* the views report connection errors */ }
}

// ---------- Router ----------
function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, id] = h.split("/");
  return { view: view || "landing", id };
}

async function route() {
  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
  const { view, id } = parse();
  main.innerHTML = "";
  const ctx = { main, navigate, setTitle, firstLoad: first, openShortcuts, health: appState.health };
  const isApp = view === "app" || ((view === "doc" || view === "chart") && id);
  document.body.dataset.view = isApp ? "app" : "landing";
  if (!first) window.scrollTo(0, 0);
  if (view === "doc" && id) cleanup = await renderDocument(ctx, id);
  else if (view === "chart" && id) cleanup = await renderChart(ctx, id);
  else if (view === "app") cleanup = await renderHome(ctx);
  else cleanup = await renderLanding(ctx);
}

function setTitle(text, { focus = !first } = {}) {
  document.title = text ? `${text} · Hear the Graph` : "Hear the Graph";
  if (focus) {
    const h1 = main.querySelector("h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: false }); }
  }
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// In-page anchors (skip link, "Why" links) move focus without touching the router.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.getAttribute("href").startsWith("#/")) return;
  const target = document.getElementById(a.getAttribute("href").slice(1));
  if (!target) return;
  e.preventDefault();
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
  target.scrollIntoView({ block: "start" });
});

let first = true;
window.addEventListener("hashchange", () => {
  if (location.hash && !location.hash.startsWith("#/")) return; // an anchor, not a route
  first = false;
  route();
});
loadHealth().then(() => route().then(() => { first = false; }));
