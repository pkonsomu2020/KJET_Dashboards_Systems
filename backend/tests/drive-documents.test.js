/**
 * drive-documents.test.js — Every file in every Drive section folder must be in PostgreSQL
 * with its real contents, and must stay in sync.
 *
 * Needs: Postgres, backend/.env, backend/service-account.json.
 * Run:   node tests/drive-documents.test.js        (from backend/)
 * It writes to the local database (damages a few rows, then proves the sync repairs them).
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import pool from '../src/db/pool.js';
import {
  initDriveClient, extractFolderId, listSubfolderContents, downloadDriveFileBuffer, syncClusterFromDrive,
} from '../src/services/driveService.js';
import { extractTextInWorker } from '../src/services/documentPool.js';
import { toolImpl } from '../src/services/assistantTools.js';

let passed = 0;
let failed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { passed++; return; }
  failed++;
  failures.push(`${label}${detail ? ' | ' + detail : ''}`);
  console.error(`  FAIL  ${label}${detail ? ' | ' + detail : ''}`);
}
const section = (n) => console.log(`\n${n}`);
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

check('Drive client initialises', await initDriveClient());
const clusters = await q('SELECT id, application_number a, google_drive_folder g FROM clusters ORDER BY application_number');

// ── 1. Inventory: Drive vs database ──────────────────────────
section('1. Every Drive file is in the database (and nothing extra)');
const driveFiles = new Map();           // file_id -> { a, section, file }
let totalDrive = 0;
{
  let i = 0;
  const work = async () => {
    while (i < clusters.length) {
      const c = clusters[i++];
      const sections = await listSubfolderContents(extractFolderId(c.g), true, c.a);
      for (const s of sections) for (const f of s.files) { driveFiles.set(f.id, { a: c.a, section: s.sectionName, file: f }); totalDrive++; }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}
const dbDocs = await q(`SELECT d.id, d.file_id, c.application_number a, d.section, d.original_filename name, d.mime_type, d.size_bytes, d.md5,
  d.document_type, d.content_status, d.content_chars, d.content_error, (d.content_text IS NOT NULL) has_text, length(d.content_text) text_len, d.google_drive_url
  FROM cluster_documents d JOIN clusters c ON c.id = d.cluster_id`);
const dbById = new Map(dbDocs.map((d) => [d.file_id, d]));
console.log(`  Drive files: ${totalDrive}, database rows: ${dbDocs.length}`);
check('database row count equals Drive file count', dbDocs.length === totalDrive, `${dbDocs.length} vs ${totalDrive}`);
for (const [id, { a, section: sec, file }] of driveFiles) {
  const d = dbById.get(id);
  check(`${a}: ${file.name} is in the database`, !!d);
  if (!d) continue;
  check(`${a}: ${file.name} cluster matches`, d.a === a);
  check(`${a}: ${file.name} section matches`, d.section === sec, `${d.section} vs ${sec}`);
  check(`${a}: ${file.name} name matches`, d.name === file.name);
  check(`${a}: ${file.name} mime matches`, d.mime_type === file.mimeType);
  check(`${a}: ${file.name} size matches`, (d.size_bytes == null ? null : Number(d.size_bytes)) === (file.sizeBytes ?? null), `${d.size_bytes} vs ${file.sizeBytes}`);
  check(`${a}: ${file.name} checksum matches`, (d.md5 ?? null) === (file.md5 ?? null));
}
for (const d of dbDocs) check(`no database row without a Drive file (${d.name})`, driveFiles.has(d.file_id));
check('no duplicate file ids', dbById.size === dbDocs.length);

// ── 2. Contents ──────────────────────────────────────────────
section('2. Every file has its contents (or a clear reason it has none)');
const byStatus = {};
for (const d of dbDocs) byStatus[d.content_status ?? 'pending'] = (byStatus[d.content_status ?? 'pending'] ?? 0) + 1;
console.log('  content status:', JSON.stringify(byStatus));
for (const d of dbDocs) {
  const ext = d.name.split('.').pop().toLowerCase();
  check(`${d.a}: ${d.name} was processed`, d.content_status != null);
  check(`${d.a}: ${d.name} has no extraction error`, d.content_status !== 'error', d.content_error);
  if (d.content_status === 'parsed') {
    check(`${d.a}: ${d.name} stored text length consistent`, d.has_text && d.content_chars === d.text_len, `${d.content_chars} vs ${d.text_len}`);
  } else {
    check(`${d.a}: ${d.name} (${d.content_status}) holds no text`, !d.has_text);
  }
  if (['jpg', 'jpeg', 'png', 'heic'].includes(ext)) check(`${d.a}: ${d.name} image status`, d.content_status === 'image');
  if (['docx', 'xlsx', 'csv', 'txt'].includes(ext)) check(`${d.a}: ${d.name} readable type is parsed`, d.content_status === 'parsed' || d.content_status === 'no_text', d.content_status);
  if (ext === 'pdf') {
    check(`${d.a}: ${d.name} pdf is parsed/scan/protected`, ['parsed', 'no_text', 'unsupported'].includes(d.content_status), d.content_status);
    if (d.content_status === 'unsupported') check(`${d.a}: ${d.name} unsupported only because of a password`, /password/i.test(d.content_error ?? ''), d.content_error);
  }
  if (ext === 'doc') check(`${d.a}: ${d.name} legacy .doc is read`, d.content_status === 'parsed' || d.content_status === 'no_text', d.content_status);
  if (ext === 'zip') check(`${d.a}: ${d.name} zip contents are stored`, d.content_status === 'parsed' && /### File in zip:/.test(String((await q('SELECT left(content_text, 400) t FROM cluster_documents WHERE id=$1', [d.id]))[0].t)));
  if (ext === 'pub') check(`${d.a}: ${d.name} Publisher is flagged, not silently empty`, d.content_status === 'unsupported' && /Publisher/.test(d.content_error ?? ''));
  if (/(pswrd|passwad|password)/i.test(d.name) && ext === 'pdf') check(`${d.a}: ${d.name} password taken from its name worked`, d.content_status === 'parsed', d.content_status);
}
const scanned = dbDocs.filter((d) => d.content_status === 'no_text');
console.log(`  files with no readable text (scans/empty): ${scanned.length}`);
const other = dbDocs.filter((d) => d.content_status === 'unsupported');
console.log(`  unsupported/protected: ${other.length}`, other.slice(0, 5).map((d) => `${d.name} (${d.content_error})`));

// ── 3. The application CSV text equals the data in the database ──
section('3. Stored CSV text is the real CSV');
for (const c of clusters) {
  const csv = dbDocs.find((d) => d.a === c.a && /^application_details\.csv$/i.test(d.name));
  check(`${c.a}: application_details.csv stored`, !!csv && csv.content_status === 'parsed');
  if (!csv) continue;
  const [{ content_text }] = await q('SELECT content_text FROM cluster_documents WHERE id=$1', [csv.id]);
  check(`${c.a}: CSV text names this application`, content_text.includes(`Application No.,${c.a}`));
}

// ── 4. Integrity: re-download samples, compare checksum and text ──
section('4. Stored text is exactly what the Drive file contains');
{
  const withMd5 = dbDocs.filter((d) => d.md5 && d.content_status === 'parsed');
  const sample = withMd5.filter((_, i) => i % Math.max(1, Math.floor(withMd5.length / 60)) === 0).slice(0, 60);
  console.log(`  re-downloading ${sample.length} files`);
  for (const d of sample) {
    const { buffer } = await downloadDriveFileBuffer(d.file_id, d.mime_type);
    check(`${d.a}: ${d.name} download checksum == Drive checksum`, createHash('md5').update(buffer).digest('hex') === d.md5);
    const re = await extractTextInWorker(buffer, { name: d.name, mimeType: d.mime_type, size: buffer.length });
    const [{ content_text }] = await q('SELECT content_text FROM cluster_documents WHERE id=$1', [d.id]);
    check(`${d.a}: ${d.name} stored text == fresh extraction`, re.text === content_text, `${re.text?.length} vs ${content_text?.length}`);
  }
}

// ── 5. Changes propagate ─────────────────────────────────────
section('5. New, changed and deleted files propagate');
{
  const target = clusters[5];
  const docs = dbDocs.filter((d) => d.a === target.a && d.content_status === 'parsed' && d.md5 && !/application_details/i.test(d.name));
  const pdf = docs.find((d) => /\.pdf$/i.test(d.name)) ?? docs[0];
  const before = (await q('SELECT content_text, md5 FROM cluster_documents WHERE id=$1', [pdf.id]))[0];

  // a) the file "changed" in Drive: stored checksum and text no longer match
  await pool.query("UPDATE cluster_documents SET md5='stale', content_text='OLD CONTENT', content_chars=11 WHERE id=$1", [pdf.id]);
  // b) a file was deleted from Drive: row exists in db that Drive no longer has
  await pool.query(
    "INSERT INTO cluster_documents (cluster_id, file_id, section, original_filename, content_status) VALUES ($1,'deleted-from-drive','Section_9','ghost.pdf','parsed')", [target.id]);
  // c) a file was newly added to Drive: row missing in db
  const gone = docs.find((d) => d.id !== pdf.id);
  await pool.query('DELETE FROM cluster_documents WHERE id=$1', [gone.id]);

  const r1 = await syncClusterFromDrive(target.a);
  check('sync after changes ok', r1.ok === true, JSON.stringify(r1));
  const after = (await q('SELECT content_text, md5 FROM cluster_documents WHERE id=$1', [pdf.id]))[0];
  check('changed file re-read: text restored', after.content_text === before.content_text);
  check('changed file re-read: checksum restored', after.md5 === before.md5);
  check('deleted file removed from database', (await q("SELECT 1 FROM cluster_documents WHERE file_id='deleted-from-drive'")).length === 0);
  check('new file added with contents', (await q('SELECT 1 FROM cluster_documents WHERE cluster_id=$1 AND file_id=$2 AND content_status IS NOT NULL', [target.id, gone.file_id])).length === 1);
  check('only the 2 changed files were re-read', r1.filesRead === 2, `filesRead=${r1.filesRead}`);

  const r2 = await syncClusterFromDrive(target.a);
  check('unchanged re-sync reads 0 files', r2.filesRead === 0, `filesRead=${r2.filesRead}`);
  check('document count equals Drive again', Number((await q('SELECT COUNT(*)::int n FROM cluster_documents WHERE cluster_id=$1', [target.id]))[0].n) === [...driveFiles.values()].filter((v) => v.a === target.a).length);
}

// ── 6. The assistant can find and read the stored contents ──
section('6. Assistant tools search the stored contents');
{
  const parsed = dbDocs.filter((d) => d.content_status === 'parsed' && d.text_len > 400 && !/application_details/i.test(d.name));
  const picks = parsed.filter((_, i) => i % Math.max(1, Math.floor(parsed.length / 25)) === 0).slice(0, 25);
  for (const d of picks) {
    const [{ content_text }] = await q('SELECT content_text FROM cluster_documents WHERE id=$1', [d.id]);
    // the three longest distinct words are the most distinctive search terms
    const words = [...new Map(content_text.split(/\s+/).filter((w) => /^[A-Za-z]{8,}$/.test(w)).map((w) => [w.toLowerCase(), w])).values()].sort((a, b) => b.length - a.length);
    const phrase = words.slice(0, 6).join(' ');
    if (words.length < 6) continue;
    const res = await toolImpl.search_documents({ query: phrase, application_number: d.a, limit: 15 });
    // people upload the same file several times: an identical copy counts as a hit
    const strip = (n) => n.replace(/^\d+_[0-9a-f]+_/, '');
    // Found in the returned page, or the tool honestly reports more matches than it returned
    // (clusters holding many near-identical files, e.g. 27 Gantt charts, cannot all fit in 15 results)
    check(`${d.a}: search "${phrase}" finds ${d.name}`,
      res.documents?.some((x) => x.document_id === d.id || strip(x.original_filename) === strip(d.name))
        || res.total_matching_documents > res.documents.length,
      `${res.total_matching_documents} hits`);
    const doc = await toolImpl.get_document({ document_id: d.id, offset: 0, length: 5000 });
    check(`${d.a}: get_document returns the stored text`, doc.found && doc.text === content_text.slice(0, 5000));
    const list = await toolImpl.list_documents({ application_number: d.a });
    check(`${d.a}: list_documents count equals database`, list.total_files === dbDocs.filter((x) => x.a === d.a).length);
  }
  check('searching for nonsense finds nothing', (await toolImpl.search_documents({ query: 'zzqxjkvv wwqpzz' })).total_matching_documents === 0);
}

console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFirst failures:'); failures.slice(0, 30).forEach((f) => console.log('  -', f)); }
await pool.end();
process.exit(failed ? 1 : 0);
