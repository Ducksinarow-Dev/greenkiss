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

/* ─── Shared list/heading detection (used by both docx + pdf paths) ─── */

const CHECK_RE = /^\s*(?:[-*•]\s*)?(\[[ xX]?\]|☐|☑|✅|✔|▢|◻|☑️)\s*(.*)$/;
const NUM_RE = /^\s*(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+(.*\S.*)$/i;
const BULLET_RE = /^\s*[•◦‣·○●▪▸►*·–—-]\s+(.*\S.*)$/;

/** Classifies one line as a list item, or null if it's prose. Recognizes
 * checkbox (`[ ]`, `☐`), numbered/lettered (`1.`, `a)`, `iv.`), and bullet
 * (`•`, `-`, `*`, …) markers, returning the marker-stripped text plus flags
 * so the run can be assembled into the right kind of real `list` block. */
function parseListLine(raw) {
  const line = (raw || "").replace(/\u00A0/g, " ");
  let m = line.match(CHECK_RE);
  if (m && m[2].trim()) return { text: m[2].trim(), checkbox: true, checked: /[xX☑✅✔]/.test(m[1]) };
  m = line.match(NUM_RE);
  if (m) return { text: m[1].trim(), ordered: true };
  m = line.match(BULLET_RE);
  if (m) return { text: m[1].trim() };
  return null;
}

/** Builds a real `list` block from a run of parseListLine results. Any
 * checkbox in the run makes it a checkbox list; otherwise all-numbered ->
 * numbered, else bulleted. Matches the ListBlock shape in globals.js so it
 * lands in the editor as an editable list, not "• "-prefixed prose. */
function makeListBlock(items, styleHint) {
  const checkboxes = items.some(i => i.checkbox);
  const numbered = !checkboxes && (styleHint === "numbered" || items.every(i => i.ordered));
  return {
    id: uid(), type: "list",
    style: numbered ? "numbered" : "bulleted",
    checkboxes, withEntry: false,
    items: items.map(i => ({ id: uid(), text: i.text, value: "", url: i.url || "" })),
  };
}

/** True if a short line reads as a section heading by its formatting alone.
 * `size`/`median` (PDF only) flag a line rendered noticeably larger than body
 * text — the real "find the sections" signal. With no size info (docx plain
 * text), falls back to ALL-CAPS or a trailing-colon label. */
function textLooksLikeHeading(text, { size = 0, median = 0 } = {}) {
  if (!text || text.length > 90) return false;
  if (parseListLine(text)) return false; // a numbered/bulleted line is a list item, not a heading
  if (median && size >= median * 1.2) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (text.length < 70 && letters.length >= 3 && text === text.toUpperCase()) return true; // ALL CAPS
  if (text.length < 70 && /:$/.test(text) && !/[.?!]/.test(text.slice(0, -1))) return true; // "Section:" label
  return false;
}

/** True if a <p> reads as a heading rather than body text: mammoth maps
 * Word's Heading 1-6 paragraph styles to <h1-6>, but source docs exported
 * from Pages (like the real Green Kiss docs) don't carry those styles —
 * everything lands as plain <p>, with headings only distinguishable by
 * formatting. A paragraph whose entire text is wrapped in one <strong>/<b>
 * (whole line bold, not a bolded word mid-sentence), or that reads ALL-CAPS
 * / as a trailing-colon label (textLooksLikeHeading), is treated as a
 * heading. Links inside paragraphs are preserved onto list items (item.url)
 * but flattened to plain text inside prose in v1. */
function paragraphLooksLikeHeading(el) {
  const text = el.textContent.trim();
  if (!text || text.length > 90) return false;
  const kids = Array.from(el.childNodes).filter(n => !(n.nodeType === 3 && !n.textContent.trim()));
  const wholeBold = kids.length === 1 && kids[0].nodeType === 1 && /^(strong|b)$/i.test(kids[0].tagName);
  return wholeBold || textLooksLikeHeading(text);
}

/** Walks mammoth's converted HTML into Block[]. h1-h6 -> heading, whole-
 * paragraph-bold / ALL-CAPS / trailing-colon -> heading (paragraphLooksLikeHeading),
 * consecutive plain paragraphs merge into ONE text block. <ul>/<ol> AND runs
 * of plain paragraphs that are really bullet/numbered/checkbox lines (common
 * in Pages exports that don't use real list markup) become real `list` blocks
 * (see makeListBlock), preserving per-item links. <img> -> image block. */
function parseDocxHtmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [];
  let paraBuf = [];
  let listBuf = [];
  const flushPara = () => {
    if (paraBuf.length) { blocks.push({ id: uid(), type: "text", text: paraBuf.join("\n\n") }); paraBuf = []; }
  };
  const flushList = () => {
    if (listBuf.length) { blocks.push(makeListBlock(listBuf)); listBuf = []; }
  };
  const flushAll = () => { flushList(); flushPara(); };

  Array.from(doc.body.children).forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      flushAll();
      const text = el.textContent.trim();
      if (text) blocks.push({ id: uid(), type: "heading", text });
    } else if (tag === "ul" || tag === "ol") {
      flushAll();
      const ordered = tag === "ol";
      const items = Array.from(el.children).filter(li => li.tagName.toLowerCase() === "li").map(li => {
        const raw = li.textContent.trim();
        const parsed = parseListLine(raw) || {};
        const a = li.querySelector("a[href]");
        return { text: parsed.text || raw, ordered, checkbox: parsed.checkbox, checked: parsed.checked, url: a ? a.getAttribute("href") : "" };
      }).filter(it => it.text);
      if (items.length) blocks.push(makeListBlock(items, ordered ? "numbered" : "bulleted"));
    } else if (tag === "p") {
      const img = el.querySelector("img");
      if (img && img.src) { flushAll(); blocks.push({ id: uid(), type: "image", src: img.src, caption: "" }); return; }
      const text = el.textContent.trim();
      if (!text) return;
      const li = parseListLine(text);
      if (li) { flushPara(); listBuf.push(li); return; }
      flushList();
      if (paragraphLooksLikeHeading(el)) blocks.push({ id: uid(), type: "heading", text });
      else paraBuf.push(text);
    }
    // Tables and anything else are skipped in v1 — rare in SOP-style docs.
  });
  flushAll();
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
 * by y-coordinate, capturing each line's font size (largest glyph height on
 * the line). Sections are found by font size: a line rendered notably larger
 * than the body-text median reads as a heading (textLooksLikeHeading) — far
 * more reliable than the old "short line followed by a longer one" guess.
 * Bullet/numbered/checkbox runs become real `list` blocks (makeListBlock);
 * everything else merges into paragraph blocks.
 * // ponytail: no image extraction from PDFs — pdf.js can pull embedded images
 * // via page.getOperatorList() image ops if that's ever needed. */
async function parsePdfToBlocks(file) {
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = []; // {text, size} — size 0 marks a page/paragraph break
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
      const runs = byY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const text = runs.map(i => i.str).join("").trim();
      if (!text) return;
      const size = Math.max(...runs.map(i => i.height || Math.abs(i.transform[3]) || 0));
      lines.push({ text, size });
    });
    lines.push({ text: "", size: 0 }); // page break reads as a paragraph break
  }

  // Body-text median font size — the baseline headings stand out from.
  const sizes = lines.filter(l => l.text && l.size).map(l => l.size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

  const blocks = [];
  let paraBuf = [];
  let listBuf = [];
  const flushPara = () => {
    if (paraBuf.length) { blocks.push({ id: uid(), type: "text", text: paraBuf.join("\n") }); paraBuf = []; }
  };
  const flushList = () => {
    if (listBuf.length) { blocks.push(makeListBlock(listBuf)); listBuf = []; }
  };
  const flushAll = () => { flushList(); flushPara(); };

  for (const { text, size } of lines) {
    if (!text) { flushAll(); continue; }
    const li = parseListLine(text);
    if (li) { flushPara(); listBuf.push(li); continue; }
    flushList();
    if (textLooksLikeHeading(text, { size, median })) { flushPara(); blocks.push({ id: uid(), type: "heading", text }); }
    else paraBuf.push(text);
  }
  flushAll();
  return blocks;
}

async function importPdf(file) {
  const blocks = await parsePdfToBlocks(file);
  if (!blocks.length) throw new Error("Couldn't extract any text from that PDF.");
  return blocks;
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
