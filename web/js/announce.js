// Everything the app says goes through ARIA live regions, so it reaches VoiceOver,
// NVDA and JAWS. The built-in voice (Web Speech API) is optional and off by default,
// so it never talks over a screen reader.

const polite = () => document.getElementById("announcer");
const assertive = () => document.getElementById("announcer-assertive");

let voiceOn = false;
try { voiceOn = localStorage.getItem("voice") === "on"; } catch (e) { /* storage blocked */ }

export function isVoiceOn() { return voiceOn; }

export function setVoice(on) {
  voiceOn = on;
  try { localStorage.setItem("voice", on ? "on" : "off"); } catch (e) { /* ignore */ }
  if (!on && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

let seq = 0;
export function announce(text, { urgent = false } = {}) {
  const region = urgent ? assertive() : polite();
  if (!region || !text) return;
  const id = ++seq;
  region.textContent = "";
  // A short delay makes screen readers treat repeated text as new.
  setTimeout(() => { if (id === seq) region.textContent = text; }, 60);
  speak(text);
}

/** Mirror a live region that another library writes to (Chart2Music) into the built-in voice. */
export function mirrorToVoice(el) {
  const obs = new MutationObserver(() => {
    if (!voiceOn) return;
    const last = el.lastElementChild || el;
    const t = (last.getAttribute?.("data-original-text") || last.textContent || "").trim();
    if (t) speak(t);
  });
  obs.observe(el, { childList: true, subtree: true, characterData: true });
  return () => obs.disconnect();
}
