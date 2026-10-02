// Small helpers shared by the views.

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function decimalsFor(span) {
  if (!span || !isFinite(span) || span <= 0) return 2;
  const step = span / 200;
  return step < 1 ? Math.max(0, Math.min(4, Math.ceil(-Math.log10(step)))) : 0;
}

export function fmtNum(v, decimals = 2) {
  if (v === null || v === undefined || !isFinite(v)) return "unknown";
  let s = Number(v).toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s;
}

export function withUnit(text, unit) {
  if (!unit) return text;
  if (unit === "%") return `${text}%`;
  if (unit === "$") return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
  return `${text} ${unit}`;
}

/** Formatting for one chart: y values with sensible precision and unit, x labels. */
export function chartFormat(chart) {
  const y = chart.y_axis;
  const dec = y.scale === "log" ? 2 : decimalsFor(y.max - y.min);
  const fy = (v) => {
    if (y.scale === "log" && Math.abs(v) >= 100) return withUnit(fmtNum(v, 0), y.unit);
    if (y.scale === "log") return withUnit(fmtNum(v, Math.max(dec, 2)), y.unit);
    return withUnit(fmtNum(v, dec), y.unit);
  };
  const xName = chart.x_axis.label ? chart.x_axis.label.replace(/\s*\(.*\)\s*$/, "") : "x";
  const fx = (p) => withUnit(p.x_label ?? fmtNum(p.x, 4), chart.x_axis.scale === "category" ? "" : chart.x_axis.unit);
  return { fy, fx, xName, dec };
}

export const LEVEL_TEXT = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

/** Shape plus word plus color, never color alone. */
export function levelIcon(level) {
  if (level === "high") return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg>`;
  if (level === "medium") return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L19 18 L1 18 Z" fill="currentColor"/></svg>`;
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 L18.5 10 L10 18.5 L1.5 10 Z" fill="none" stroke="currentColor" stroke-width="2.5"/><text x="10" y="14" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">?</text></svg>`;
}

export function levelBadge(level) {
  return `<span class="level ${esc(level)}">${levelIcon(level)}<span>${LEVEL_TEXT[level] || level}</span></span>`;
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function typeName(t) {
  return { line: "Line chart", bar: "Bar chart", scatter: "Scatter plot" }[t] || "Chart";
}
