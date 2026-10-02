// Ask by voice. The browser's speech recognition (Web Speech API) turns a spoken question into
// text, which is then asked exactly like a typed one: Gemini picks the calculation, code answers.
// Chrome, Edge and Safari have it; Firefox does not, and the button stays hidden there.
//
// Nothing is spoken when listening starts, because the microphone would pick up the screen reader
// or the built-in voice. A short rising tone means "speak now"; a falling tone means "done".
// The tone waits for the microphone to deliver audio ("audiostart"), which was measured to take
// up to 4 s after "start" (a Bluetooth or Continuity microphone), so the first words are not lost.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function canListen() { return Boolean(Recognition); }

const MAX_LISTEN_MS = 15000;
// Recognizers sometimes stall after the last word without ever sending a final result; stop
// (which finalizes) once no new words have come for this long.
const QUIET_MS = 2000;

const ERRORS = {
  "not-allowed": "The microphone is blocked for this site. Allow it in your browser's site settings, or type your question.",
  "service-not-allowed": "Speech recognition is turned off in this browser. Type your question instead.",
  "audio-capture": "No microphone was found. Connect one, or type your question.",
  "network": "Speech recognition needs an internet connection in this browser. Type your question instead.",
  "no-speech": "I didn't hear a question. Press Ask by voice and speak after the tone.",
  "language-not-supported": "Speech recognition does not support this language here. Type your question instead.",
};

export class VoiceInput {
  /**
   * sound: the player's Sound, for the start and stop tones.
   * onOpening() (waiting for the microphone), onStart() (speak now), onInterim(text),
   * onFinal(text), onEnd(), onError(message): what the page shows.
   */
  constructor({ sound, onOpening, onStart, onInterim, onFinal, onEnd, onError }) {
    this.sound = sound;
    this.cb = { onOpening, onStart, onInterim, onFinal, onEnd, onError };
    this.rec = null;
    this.listening = false;
  }

  _tone(up) {
    // Two short notes, centered: rising before listening, falling after.
    const [a, b] = up ? [660, 990] : [990, 660];
    if (!this.sound?.ensure()) return;
    const t = this.sound.now + 0.01;
    this.sound.note(a, 0, 0.09, { at: t, level: 0.22, wave: "sine" });
    this.sound.note(b, 0, 0.11, { at: t + 0.1, level: 0.22, wave: "sine" });
  }

  toggle() { this.listening ? this.stop() : this.start(); }

  start() {
    if (!Recognition || this.listening) return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const rec = new Recognition();
    const lang = navigator.language || "en-US";
    rec.lang = lang.toLowerCase().startsWith("en") ? lang : "en-US"; // answers are in English
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let final = "";
    let heard = ""; // final and interim text so far
    let error = "";
    let open = false;
    rec.onstart = () => { this.cb.onOpening?.(); };
    rec.onaudiostart = () => { open = true; this._tone(true); this.cb.onStart?.(); };
    rec.onresult = (e) => {
      let interim = "";
      final = "";
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      // Chrome can send an empty result when it is stopped; never let it erase what was heard.
      const now = (final + interim).trim();
      if (!now) return;
      heard = now;
      this.cb.onInterim?.(heard);
      clearTimeout(this.quiet);
      this.quiet = setTimeout(() => this.stop(), QUIET_MS);
    };
    rec.onerror = (e) => { error = e.error || "unknown"; };
    rec.onend = () => {
      clearTimeout(this.timer);
      clearTimeout(this.quiet);
      this.listening = false;
      this.rec = null;
      if (open) this._tone(false);
      this.cb.onEnd?.();
      // Ended without a final result (stopped, or a stalled recognizer): ask what was heard.
      const text = final.trim() || (error === "aborted" ? "" : heard);
      if (text) this.cb.onFinal?.(text);
      else if (error === "aborted") { /* stopped on purpose */ }
      else this.cb.onError?.(ERRORS[error] || ERRORS["no-speech"]);
    };
    this.rec = rec;
    this.listening = true;
    this.timer = setTimeout(() => this.stop(), MAX_LISTEN_MS);
    try {
      rec.start();
    } catch (err) {
      clearTimeout(this.timer);
      this.listening = false;
      this.rec = null;
      this.cb.onEnd?.();
      this.cb.onError?.("Speech recognition could not start. Type your question instead.");
    }
  }

  /** Stop listening; whatever was heard so far is still asked. */
  stop() { this.rec?.stop(); }

  /** Stop without asking (leaving the page). */
  abort() {
    if (!this.rec) return;
    this.cb = {};
    this.rec.abort();
  }
}
