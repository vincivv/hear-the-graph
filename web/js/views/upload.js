// File upload by drag and drop or file picker, with limits stated up front.

import { api } from "../api.js";
import { announce } from "../announce.js";
import { esc } from "../util.js";

const TYPES = { "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WEBP" };
const MAX_MB = 20;

export function uploadSection(health) {
  const maxMb = health?.limits?.max_mb ?? MAX_MB;
  const maxPages = health?.limits?.max_pages ?? 40;
  return `
  <section class="panel upload-panel" aria-labelledby="upload-title">
    <div class="panel-head"><h2 id="upload-title">Your file</h2></div>
    <div class="dropzone" id="dropzone">
      <span class="drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <p class="drop-title">Drop a PDF or image here</p>
      <input type="file" id="file-input" class="visually-hidden" tabindex="-1" aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp">
      <button type="button" class="btn btn-primary" id="file-label" aria-describedby="upload-limits">Choose a file</button>
      <p id="upload-limits" class="small soft">PDF, PNG, JPG or WEBP, up to ${maxMb} MB and ${maxPages} pages.</p>
    </div>
    <div id="upload-error" role="alert"></div>
    <h3 class="visually-hidden">What happens next</h3>
    <ol class="next-steps">
      <li><span><strong>Every chart is found</strong>Each page is scanned and every chart is listed with its page and title.</span></li>
      <li><span><strong>Each chart is read and checked</strong>Read twice, compared, and checked against the image for a confidence level.</span></li>
      <li><span><strong>You listen and ask</strong>Play it, step through the values, and ask questions.</span></li>
    </ol>
  </section>`;
}

export function wireUpload(root, navigate, health) {
  const input = root.querySelector("#file-input");
  const zone = root.querySelector("#dropzone");
  const errBox = root.querySelector("#upload-error");
  const label = root.querySelector("#file-label");
  const maxMb = health?.limits?.max_mb ?? MAX_MB;

  label.addEventListener("click", () => input.click());

  function showError(msg) {
    errBox.innerHTML = `<div class="error-box"><p>${esc(msg)}</p></div>`;
  }

  async function send(file) {
    errBox.innerHTML = "";
    if (!file) return;
    const okType = TYPES[file.type] || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!okType) return showError(`"${file.name}" is not a supported file. Choose a PDF, PNG, JPG, or WEBP file.`);
    if (file.size > maxMb * 1024 * 1024) return showError(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${maxMb} MB. Compress it or upload only the pages with charts.`);
    if (file.size === 0) return showError(`"${file.name}" is empty. Choose the file again.`);
    label.textContent = "Uploading…";
    announce(`Uploading ${file.name}.`);
    try {
      const { id } = await api.upload(file);
      navigate(`#/doc/${id}`);
    } catch (e) {
      label.textContent = "Choose a file";
      showError(e.message);
    }
  }

  input.addEventListener("change", () => send(input.files[0]));
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => send(e.dataTransfer?.files?.[0]));
}
