// Thin wrappers around the JSON API. Errors carry the server's plain-language message.

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError("The server could not be reached. Check that it is running, then try again.", 0);
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const msg = body && typeof body.detail === "string" ? body.detail : `The request failed (${res.status}). Try again.`;
    throw new ApiError(msg, res.status);
  }
  return body;
}

export const api = {
  health: () => request("/api/health"),
  samples: () => request("/api/samples"),
  upload(file) {
    const fd = new FormData();
    fd.append("file", file);
    return request("/api/documents", { method: "POST", body: fd });
  },
  startSample: (name) => request(`/api/samples/${encodeURIComponent(name)}`, { method: "POST" }),
  document: (id) => request(`/api/documents/${encodeURIComponent(id)}`),
  deleteDocument: (id) => request(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  chart: (id) => request(`/api/charts/${encodeURIComponent(id)}`),
  ask: (id, question, series) => request(`/api/charts/${encodeURIComponent(id)}/ask`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, series }),
  }),
  retry: (id) => request(`/api/charts/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  chartImage: (id, variant = "original") => `/api/charts/${encodeURIComponent(id)}/image${variant === "original" ? "" : `?variant=${variant}`}`,
};

/** Live document updates over server-sent events, with polling as a fallback. */
export function watchDocument(id, onUpdate, onError) {
  let closed = false;
  let es = null;
  let timer = null;
  const poll = async () => {
    if (closed) return;
    try {
      const d = await api.document(id);
      onUpdate(d);
      if (d.status === "done" || d.status === "failed") return;
    } catch (e) { onError?.(e); return; }
    timer = setTimeout(poll, 600);
  };
  if ("EventSource" in window) {
    es = new EventSource(`/api/documents/${encodeURIComponent(id)}/events`);
    es.onmessage = (ev) => { try { onUpdate(JSON.parse(ev.data)); } catch (e) { /* ignore */ } };
    es.addEventListener("end", () => { es.close(); });
    es.addEventListener("gone", () => { es.close(); onError?.(new ApiError("This document was deleted.", 404)); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED || !closed) { es.close(); if (!closed) poll(); } };
  } else {
    poll();
  }
  return () => { closed = true; es?.close(); clearTimeout(timer); };
}
