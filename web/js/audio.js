// Web Audio engine. Chart2Music plays single points through `c2mEngine()`; the
// whole-graph sweep is scheduled here so the playhead can follow the audio clock.
// An uncertain point gets a soft band-passed hiss on top of its note.

// Semitones from G3 (196 Hz) to C6 (1047 Hz). Shared with Chart2Music so a point
// sounds the same in the sweep and when stepping with the arrow keys.
export const HERTZES = (() => {
  const out = [];
  for (let i = 0; i <= 29; i++) out.push(196 * Math.pow(2, i / 12));
  return out;
})();

export function pitchIndex(pct) {
  const n = HERTZES.length - 1;
  return Math.max(0, Math.min(n, Math.floor(n * Math.max(0, Math.min(1, pct)))));
}

export function panFor(t) { return (t * 2 - 1) * 0.98; }

export class Sound {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.noise = null;
    this.active = new Set();
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.7;
      this.out.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  _track(node, until) {
    this.active.add(node);
    node.onended = () => this.active.delete(node);
    node.stop(until);
  }

  /** One note: pitch, stereo position, length in seconds. */
  note(freq, pan, dur, { at = null, uncertain = false, level = 0.3, wave = "triangle" } = {}) {
    if (!this.ensure()) return;
    const t = at ?? this.now + 0.01;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.setValueAtTime(level, t + Math.max(0.02, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, t);
    osc.connect(g).connect(p).connect(this.out);
    osc.start(t);
    this._track(osc, t + dur + 0.02);
    if (uncertain) this.hiss(freq, pan, t, Math.max(dur, 0.18));
  }

  /** The uncertainty cue: a short, soft hiss centered on the note's pitch. */
  hiss(freq, pan, at, dur = 0.2) {
    if (!this.ensure()) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(Math.min(4000, freq * 3), at);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, at);
    src.connect(bp).connect(g).connect(p).connect(this.out);
    src.start(at, Math.random() * 0.5);
    this._track(src, at + dur + 0.02);
  }

  stopAll() {
    for (const n of this.active) { try { n.stop(); } catch (e) { /* already stopped */ } }
    this.active.clear();
  }

  /**
   * Schedule a sweep. plan.points: [{t (0..1 along the sweep), freq, pan, uncertain}].
   * Returns { t0, duration, from } so the caller can map audio time to progress.
   */
  sweep(plan, from, duration) {
    if (!this.ensure()) return null;
    const pts = plan.points;
    const t0 = this.now + 0.06;
    const remaining = duration * (1 - from);
    const at = (t) => t0 + (t - from) * duration;
    if (plan.kind === "line") {
      // Continuous glide between points, with a soft pluck on each point.
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      const g = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      const f0 = interpFreq(pts, from);
      osc.frequency.setValueAtTime(f0, t0);
      pan.pan.setValueAtTime(panFor(from), t0);
      for (const p of pts) {
        if (p.t <= from) continue;
        osc.frequency.exponentialRampToValueAtTime(p.freq, at(p.t));
        pan.pan.linearRampToValueAtTime(p.pan, at(p.t));
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.setValueAtTime(0.16, t0 + Math.max(0.06, remaining - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + remaining + 0.02);
      osc.connect(g).connect(pan).connect(this.out);
      osc.start(t0);
      this._track(osc, t0 + remaining + 0.05);
      for (const p of pts) {
        if (p.t < from - 1e-9) continue;
        this.note(p.freq, p.pan, 0.09, { at: at(p.t), uncertain: p.uncertain, level: 0.22, wave: "sine" });
      }
    } else {
      const slot = duration / Math.max(1, pts.length);
      for (const p of pts) {
        if (p.t < from - 1e-9) continue;
        this.note(p.freq, p.pan, Math.min(0.5, slot * 0.8), { at: at(p.t), uncertain: p.uncertain, level: 0.3 });
      }
    }
    return { t0, duration, from, end: t0 + remaining };
  }

  /** A Chart2Music-compatible audio engine that adds the uncertainty cue. */
  c2mEngine(isUncertain) {
    const self = this;
    return {
      masterGain: 1,
      playDataPoint(frequency, panning, duration) {
        self.note(frequency, panning, duration, { uncertain: isUncertain() });
      },
      playNotification() {},
    };
  }
}

export function interpFreq(pts, t) {
  if (!pts.length) return 440;
  if (t <= pts[0].t) return pts[0].freq;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      const u = (t - a.t) / ((b.t - a.t) || 1);
      return a.freq * Math.pow(b.freq / a.freq, u);
    }
  }
  return pts[pts.length - 1].freq;
}
