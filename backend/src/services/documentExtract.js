/**
 * documentExtract.js
 *
 * Turns the bytes of a Drive file into plain text for storage in PostgreSQL.
 * Returns { status, text, error } where status is one of:
 *   parsed       text was extracted
 *   no_text      the file is readable but holds no text (typically a scanned PDF: images only)
 *   image        a photo or scan with no text layer (needs OCR)
 *   unsupported  a format we cannot read (unknown type, or a password we do not have)
 *   too_large    skipped because the file is larger than MAX_PARSE_BYTES
 *   error        extraction failed (retried on the next sync)
 *
 * Formats: PDF (incl. password-protected when the password is known), DOCX, legacy DOC,
 * XLSX/XLS/CSV, TXT/JSON/MD, and ZIP archives (every file inside is read).
 *
 * Passwords: put them in backend/document-passwords.json (gitignored), for example
 *   { "MPESA_Statement_2026-08-15": "12345678", "1786972888_6a830ad832319": "secret" }
 * A key matches a Drive file id exactly, or any file whose name contains the key.
 * A password written in a file name next to a word like "pswrd"/"password" is also tried.
 */
import { createRequire } from 'module';
import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
let PDFParse = null;
try { PDFParse = require('pdf-parse').PDFParse; } catch { /* reported as unsupported below */ }
const WordExtractor = require('word-extractor');
const AdmZip = require('adm-zip');

export const MAX_PARSE_BYTES = 80 * 1024 * 1024;
export const MAX_TEXT_CHARS = 3_000_000;
const MAX_SHEET_ROWS = 5000;
const PARSE_TIMEOUT_MS = 90_000;
const MAX_ZIP_ENTRIES = 300;
const MAX_ZIP_DEPTH = 2;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp', '.tif', '.tiff']);
const PASSWORD_FILE = fileURLToPath(new URL('../../document-passwords.json', import.meta.url));

// ── passwords ────────────────────────────────────────────────

let passwordCache = { mtime: 0, map: {} };
function configuredPasswords() {
  try {
    if (!existsSync(PASSWORD_FILE)) return {};
    const mtime = statSync(PASSWORD_FILE).mtimeMs;
    if (mtime !== passwordCache.mtime) passwordCache = { mtime, map: JSON.parse(readFileSync(PASSWORD_FILE, 'utf8')) };
    return passwordCache.map;
  } catch { return {}; }
}

/** Candidate passwords for a file: configured ones first, then any hinted in its own name. */
function passwordsFor(name, fileId) {
  const out = [];
  for (const [key, pw] of Object.entries(configuredPasswords())) {
    if (key.startsWith('_')) continue;
    if (key === fileId || (name && name.includes(key))) out.push(String(pw));
  }
  const m = String(name).match(/(?:pass(?:word|wad|wd)?|pswrd|pwd)[\s_\-.:=]*([A-Za-z0-9]{3,20})/i);
  if (m) out.push(m[1]);
  return [...new Set(out)];
}

// ── helpers ──────────────────────────────────────────────────

function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

function cleanText(s) {
  // PostgreSQL text cannot hold NUL bytes
  return String(s ?? '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

function sheetsToText(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
      .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
      .slice(0, MAX_SHEET_ROWS);
    const lines = rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim())).join(' | '));
    parts.push(`### Sheet: ${name}\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

class PasswordNeeded extends Error {}

async function pdfText(buffer, name, fileId) {
  if (!PDFParse) throw new Error('pdf-parse unavailable');
  const attempts = [undefined, ...passwordsFor(name, fileId)];
  for (const password of attempts) {
    const parser = new PDFParse(password ? { data: buffer, password } : { data: buffer });
    try {
      return (await withTimeout(parser.getText(), PARSE_TIMEOUT_MS)).text;
    } catch (err) {
      if (!/password/i.test(String(err.message ?? err) + (err.name ?? ''))) throw err;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  throw new PasswordNeeded();
}

async function legacyDocText(buffer) {
  // Some ".doc" files are really DOCX (zip) or RTF files saved with the old extension
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return (await mammoth.extractRawText({ buffer })).value;
  const doc = await new WordExtractor().extract(buffer);
  return [doc.getBody(), doc.getFootnotes(), doc.getEndnotes(), doc.getHeaders({ includeFooters: true }), doc.getTextboxes?.()]
    .filter(Boolean).join('\n');
}

async function zipText(buffer, depth, meta) {
  const zip = new AdmZip(buffer);
  const parts = [];
  let readable = 0;
  const entries = zip.getEntries().filter((e) => !e.isDirectory).slice(0, MAX_ZIP_ENTRIES);
  for (const entry of entries) {
    const data = entry.getData();
    const r = await extractInternal(data, { name: entry.entryName, mimeType: '', size: data.length, fileId: meta.fileId }, depth + 1);
    if (r.text) readable++;
    parts.push(`### File in zip: ${entry.entryName} [${r.status}]\n${r.text ?? ''}`);
  }
  return { text: parts.join('\n\n'), readable, total: entries.length };
}

async function extractInternal(buffer, meta, depth) {
  const { name = '', mimeType = '', size = 0, fileId = '' } = meta;
  const ext = extname(name).toLowerCase();
  try {
    if (IMAGE_EXT.has(ext) || mimeType.startsWith('image/')) return { status: 'image', text: null, error: null };
    if (!buffer || buffer.length === 0) return { status: 'no_text', text: null, error: 'empty file (0 bytes) in Drive' };
    if ((size || buffer.length) > MAX_PARSE_BYTES) return { status: 'too_large', text: null, error: `${size} bytes` };

    let text = null;
    let note = null;
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      text = await pdfText(buffer, name, fileId);
    } else if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
      text = (await withTimeout(mammoth.extractRawText({ buffer }), PARSE_TIMEOUT_MS)).value;
    } else if (ext === '.doc' || mimeType === 'application/msword') {
      text = await withTimeout(legacyDocText(buffer), PARSE_TIMEOUT_MS);
    } else if (ext === '.pub') {
      return { status: 'unsupported', text: null, error: 'Microsoft Publisher file: no reader available (re-save as PDF/DOCX or install LibreOffice)' };
    } else if (ext === '.zip' || mimeType === 'application/zip') {
      if (depth >= MAX_ZIP_DEPTH) return { status: 'unsupported', text: null, error: 'zip nested too deeply' };
      const z = await zipText(buffer, depth, meta);
      text = z.text;
      note = `zip archive: ${z.readable} of ${z.total} files contain readable text`;
      if (!z.readable) return { status: 'no_text', text: null, error: note };
    } else if (['.xlsx', '.xls', '.csv'].includes(ext) || mimeType.includes('spreadsheet') || mimeType === 'text/csv' || mimeType.includes('ms-excel')) {
      if (ext === '.csv' || mimeType === 'text/csv') text = buffer.toString('utf8');   // keep CSV files verbatim
      else text = sheetsToText(buffer);
    } else if (['.txt', '.md', '.json'].includes(ext) || mimeType.startsWith('text/') || mimeType === 'application/json') {
      text = buffer.toString('utf8');
    } else {
      return { status: 'unsupported', text: null, error: ext || mimeType || 'unknown type' };
    }

    text = cleanText(text);
    // pdf-parse leaves "-- 1 of 5 --" page markers even for scans that hold only images
    const meaningful = text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').replace(/\s+/g, '');
    if (meaningful.length < 15) return { status: 'no_text', text: null, error: null };
    let error = note;
    if (text.length > MAX_TEXT_CHARS) { text = text.slice(0, MAX_TEXT_CHARS); error = `truncated to ${MAX_TEXT_CHARS} characters`; }
    return { status: 'parsed', text, error };
  } catch (err) {
    if (err instanceof PasswordNeeded) {
      return { status: 'unsupported', text: null, error: 'password-protected: add the password to backend/document-passwords.json' };
    }
    return { status: 'error', text: null, error: String(err.message ?? err).slice(0, 300) };
  }
}

/**
 * @param buffer   file bytes
 * @param meta     { name, mimeType, size, fileId }
 */
/** Changes when the reader improves or the password file is edited, so 'unsupported' files get retried. */
export const EXTRACTOR_VERSION = 2;
export function extractorVersion() {
  let mtime = 0;
  try { if (existsSync(PASSWORD_FILE)) mtime = Math.round(statSync(PASSWORD_FILE).mtimeMs); } catch { /* ignore */ }
  return `v${EXTRACTOR_VERSION}:${mtime}`;
}

export function extractText(buffer, meta = {}) {
  return extractInternal(buffer, meta, 0);
}
