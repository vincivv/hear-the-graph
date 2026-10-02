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
  if (!voiceOn || !("speechSynthesis" in window) || !text) return null;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
  return u;
}

/**
 * About how long a screen reader takes to say this at its default rate (about 15 characters a
 * second; numbers such as "48.6%" are long when spoken). A page cannot know when a screen reader
 * has finished, so this is an estimate; people who listen faster can skip the wait.
 */
export function speechTime(text) {
  return Math.min(10000, 500 + text.length * 65);
}

let seq = 0;
export function announce(text, { urgent = false } = {}) {
  const region = urgent ? assertive() : polite();
  if (!region || !text) return;
  const id = ++seq;
  region.textContent = "";
  // A short delay makes screen readers treat repeated text as new.
  setTimeout(() => { if (id === seq) region.textContent = text; }, 60);
  return speak(text);
}

/**
 * Announce, then call `then` once it has been said: when the built-in voice finishes speaking, or
 * after the estimated screen reader time. Returns a function that cancels the wait without calling
 * `then`. Used so the graph's sound never plays over its own introduction.
 */
export function announceThen(text, then) {
  let done = false;
  let timer = 0;
  const go = () => { if (done) return; done = true; clearTimeout(timer); then(); };
  const u = announce(text);
  if (u) {
    u.onend = go;
    u.onerror = go;
    timer = setTimeout(go, speechTime(text) * 1.5 + 1500); // onend does not always fire
  } else {
    timer = setTimeout(go, speechTime(text));
  }
  return () => { done = true; clearTimeout(timer); };
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
