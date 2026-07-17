import React, { useRef, useState } from 'react';
import { C, FONT_CAPS, uid, processAndStoreImage } from '../globals.js';
import { Icon } from './shared.jsx';

/* ─── SOP Importer (#5) ────────────────────────────────────────────
   Parses an uploaded .docx/.pdf into a starter SOP (headings/text/image
   blocks) so editors clean up rather than retype from scratch. Parser
   libraries (mammoth, pdf.js) are NOT in the main bundle — they're pulled
   from a pinned CDN version on first import only, via plain <script>
   injection (no npm dependency added). Landing spot is the existing
   SOPEditor: this component just hands back {title, blocks} and the
   caller opens the normal "creating" flow — no separate preview UI. */

const MAMMOTH_URL = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";

const _scriptCache = {};
function loadScript(url) {
  if (_scriptCache[url]) return _scriptCache[url];
  _scriptCache[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the import library (network issue?)."));
    document.head.appendChild(s);
  });
  return _scriptCache[url];
}
async function ensureMammoth() {
  if (!window.mammoth) await loadScript(MAMMOTH_URL);
  return window.mammoth;
}
async function ensurePdfJs() {
  if (!window.pdfjsLib) await loadScript(PDFJS_URL);
  if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
  return window.pdfjsLib;
}

/** Converts a base64 data: URI (mammoth's default inline image encoding)
 * into a File so it can go through the SAME processAndStoreImage() path
 * every other image in the app uses — downscale in dev, real upload in
 * REMOTE_MODE, no separate image-handling code needed here. */
function dataUriToFile(dataUri, filename) {
  const [meta, b64] = dataUri.split(",");
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

/** True if a <p> reads as a heading rather than body text: mammoth maps
 * Word's Heading 1-4 paragraph styles to <h1-4>, but source docs exported
 * from Pages (like the real Green Kiss docs) don't carry those styles —
 * everything lands as plain <p>, with headings only distinguishable by
 * formatting. A paragraph whose entire text is wrapped in one <strong>/<b>
 * (i.e. the whole line is bold, not just a bolded word inside a sentence)
 * reads as a heading — the same "font marks headings" signal the PDF path
 * already uses via its short-line heuristic, just sourced from mammoth's
 * HTML instead of raw font-size XML (a much smaller lift, see #5 notes). */
function paragraphLooksLikeHeading(el) {
  const text = el.textContent.trim();
  if (!text || text.length > 80) return false;
  const kids = Array.from(el.childNodes).filter(n => !(n.nodeType === 3 && !n.textContent.trim()));
  return kids.length === 1 && kids[0].nodeType === 1 && /^(strong|b)$/i.test(kids[0].tagName);
}

/** Walks mammoth's converted HTML into Block[]. h1-h4 -> heading, whole-
 * paragraph-bold -> heading too (see paragraphLooksLikeHeading), consecutive
 * plain paragraphs merge into ONE text block (flushed on a heading/list/
 * image/end of document) rather than one block per paragraph — the old
 * per-paragraph behavior produced far more blocks than a real document
 * needs. Consecutive <li> within one <ul>/<ol> -> one text block ("• "
 * lines), <img> -> image block (src hydrated after, see hydrateImages).
 * Links inside paragraphs are flattened to plain text in v1.
 * // ponytail: link-in-text is lost on import; if that matters later, walk
 * // <a> nodes here and emit a "links" block alongside the paragraph. */
function parseDocxHtmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [];
  let paraBuf = [];
  const flushPara = () => {
    if (paraBuf.length) { blocks.push({ id: uid(), type: "text", text: paraBuf.join("\n\n") }); paraBuf = []; }
  };
  Array.from(doc.body.children).forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      flushPara();
      const text = el.textContent.trim();
      if (text) blocks.push({ id: uid(), type: "heading", text });
    } else if (tag === "ul" || tag === "ol") {
      flushPara();
      const items = Array.from(el.querySelectorAll("li")).map(li => "• " + li.textContent.trim()).filter(l => l !== "• ");
      if (items.length) blocks.push({ id: uid(), type: "text", text: items.join("\n") });
    } else if (tag === "p") {
      const img = el.querySelector("img");
      if (img && img.src) {
        flushPara();
        blocks.push({ id: uid(), type: "image", src: img.src, caption: "" });
      } else if (paragraphLooksLikeHeading(el)) {
        flushPara();
        blocks.push({ id: uid(), type: "heading", text: el.textContent.trim() });
      } else {
        const text = el.textContent.trim();
        if (text) paraBuf.push(text);
      }
    }
    // Tables and anything else are skipped in v1 — rare in SOP-style docs.
  });
  flushPara();
  return blocks;
}

/** Uploads every image block's base64 src through the app's real image
 * pipeline (downscale + REMOTE_MODE upload), mutating blocks in place. */
async function hydrateImages(blocks) {
  const jobs = blocks.filter(b => b.type === "image" && (b.src || "").startsWith("data:"));
  await Promise.all(jobs.map(async b => {
    try {
      const file = dataUriToFile(b.src, "import.jpg");
      b.src = await processAndStoreImage(file);
    } catch {
      b.src = ""; // leave it blank rather than fail the whole import
    }
  }));
}

async function importDocx(file) {
  const mammoth = await ensureMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const blocks = parseDocxHtmlToBlocks(result.value || "");
  if (!blocks.length) throw new Error("Couldn't find any content in that document.");
  await hydrateImages(blocks);
  return blocks;
}

/** Groups pdf.js text-content items (individual runs, not lines) into lines
 * by y-coordinate, then applies the heading heuristic: a short line
 * (<60 chars) that doesn't end in sentence punctuation, followed by a
 * longer line, reads as a heading. Everything else merges into
 * blank-line-separated paragraph blocks.
 * // ponytail: naive heuristic, will mis-tag the odd short sentence as a
 * // heading on dense PDFs — good enough for SOP-style docs (title-cased
 * // short headers over prose); revisit with font-size metadata from
 * // pdf.js (item.transform scale) if that ever proves too noisy. */
async function parsePdfToBlocks(file) {
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map();
    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    });
    const ys = Array.from(byY.keys()).sort((a, b) => b - a); // PDF y increases upward
    ys.forEach(y => {
      const text = byY.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join("").trim();
      if (text) lines.push(text);
    });
    lines.push(""); // page break reads as a paragraph break
  }

  const blocks = [];
  let paraBuf = [];
  const flushPara = () => {
    if (paraBuf.length) { blocks.push({ id: uid(), type: "text", text: paraBuf.join("\n") }); paraBuf = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { flushPara(); continue; }
    const next = lines[i + 1] || "";
    const looksHeading = line.length < 60 && !/[.!?:,]$/.test(line) && next.length > line.length;
    if (looksHeading) { flushPara(); blocks.push({ id: uid(), type: "heading", text: line }); }
    else paraBuf.push(line);
  }
  flushPara();
  return blocks;
}

async function importPdf(file) {
  const blocks = await parsePdfToBlocks(file);
  if (!blocks.length) throw new Error("Couldn't extract any text from that PDF.");
  return blocks;
  // ponytail: no image extraction from PDFs in v1 — pdf.js can pull embedded
  // images via page.getOperatorList() image ops if that's ever needed.
}

/** Import button — editor/admin only, rendered next to "New SOP". Hands
 * {title, blocks} to the caller on success; caller opens the existing
 * SOPEditor "creating" flow with it (no new preview UI). */
function ImportSopButton({ onImported }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let blocks;
      if (ext === "docx") blocks = await importDocx(file);
      else if (ext === "pdf") blocks = await importPdf(file);
      else throw new Error("Only .docx and .pdf files can be imported.");
      const title = file.name.replace(/\.(docx|pdf)$/i, "");
      onImported({ title, blocks });
    } catch (e) {
      setErr(e.message || "Couldn't import that file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 10 }}>
      <label style={{
        fontSize: 14, fontWeight: 600, color: C.txt2, cursor: busy ? "default" : "pointer", padding: "9px 16px",
        borderRadius: 9, border: `1.5px solid ${C.bdr}`, background: C.sur, display: "inline-flex",
        textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em",
        alignItems: "center", gap: 7, opacity: busy ? 0.6 : 1,
      }}>
        {busy ? <Icon name="progress_activity" size={16} style={{ animation: "gkspin 1s linear infinite" }} /> : <Icon name="upload_file" size={16} />}
        {busy ? "Importing…" : "Import"}
        <input ref={fileRef} type="file" accept=".docx,.pdf" style={{ display: "none" }} disabled={busy}
          onChange={e => onFile(e.target.files?.[0])} />
      </label>
      {err && (
        <div style={{ fontSize: 12, color: C.red, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, maxWidth: 260 }}>
          <Icon name="error" size={14} />{err}
        </div>
      )}
    </div>
  );
}

export default ImportSopButton;
