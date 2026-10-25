/**
 * evaluationReport.js
 *
 * Builds one cluster's evaluation report as a PDF: summary, Drive figures, financial screening,
 * eligibility tests E1-E10 with reasons, and the scorecard with every rating and justification.
 * Names of assessors and reviewers are not part of the data and so never appear.
 */
import PDFDocument from 'pdfkit';
import { getEvaluationDetail } from './evaluationService.js';

const COLORS = {
  ink: '#1c2430', muted: '#5f6b7a', line: '#d9dee5', band: '#0f4c5c', soft: '#f3f6f8',
  pass: '#1e7a46', hold: '#b26b00', fail: '#b3261e',
};
const M = 46;                       // page margin
const W = 595.28 - M * 2;           // usable width (A4)

/** Helvetica has no glyphs for these; swap or drop them so nothing prints as a box. */
const clean = (v) => String(v ?? '')
  .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/ /g, ' ').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');
const kes = (v) => (v == null ? 'Not stated' : `KES ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const pct = (v) => (v == null ? 'Not stated' : `${(Number(v) * 100).toFixed(1)}%`);
const tone = (d) => (/^pass$/i.test(d) ? COLORS.pass : /^fail$/i.test(d) ? COLORS.fail : COLORS.hold);
const statusTone = (s) => (/^pass$/i.test(s ?? '') ? COLORS.pass : /fail|non-compliant/i.test(s ?? '') ? COLORS.fail : COLORS.hold);

export async function buildEvaluationReport(applicationNumber) {
  const d = await getEvaluationDetail(applicationNumber);
  if (!d) return null;

  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: {
    Title: `KJET evaluation report - ${clean(d.cluster_name)}`, Author: 'KJET Co-Investment Dashboard', Subject: d.application_number,
  } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const room = (h) => { if (doc.y + h > doc.page.height - M - 24) doc.addPage(); };
  const h2 = (text) => {
    room(60);
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor(COLORS.band).text(clean(text), M, doc.y, { width: W });
    doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor(COLORS.line).lineWidth(0.8).stroke();
    doc.moveDown(0.5).fillColor(COLORS.ink);
  };
  const para = (text, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 9).fillColor(opts.color ?? COLORS.ink)
      .text(clean(text), M + (opts.indent ?? 0), doc.y, { width: W - (opts.indent ?? 0), lineGap: 1.5 });
  };
  /** Two-column "label: value" rows. */
  const facts = (rows) => {
    for (const [label, value, color] of rows) {
      const text = clean(value ?? 'Not stated');
      const h = Math.max(doc.heightOfString(text, { width: W - 170, fontSize: 9 }), 12) + 5;
      room(h);
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(clean(label), M, y, { width: 160 });
      doc.font('Helvetica-Bold').fillColor(color ?? COLORS.ink).text(text, M + 170, y, { width: W - 170 });
      doc.y = y + h;
    }
  };
  /** A simple table: columns = [{ title, width, color? }], rows = arrays of strings. */
  const table = (cols, rows) => {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = W / total;
    const widths = cols.map((c) => c.width * scale);
    const drawRow = (cells, header) => {
      const hts = cells.map((c, i) => doc.heightOfString(clean(c.text ?? c), { width: widths[i] - 8, fontSize: 8.5 }));
      const h = Math.max(...hts, 10) + 8;
      room(h);
      const y = doc.y;
      if (header) doc.rect(M, y, W, h).fill(COLORS.band);
      else doc.rect(M, y, W, h).fill(rows.indexOf(cells) % 2 ? '#ffffff' : COLORS.soft);
      let x = M;
      cells.forEach((c, i) => {
        const text = clean(c.text ?? c);
        doc.font(header || c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(header ? '#ffffff' : (c.color ?? COLORS.ink)).text(text, x + 4, y + 4, { width: widths[i] - 8 });
        x += widths[i];
      });
      doc.y = y + h;
    };
    drawRow(cols.map((c) => c.title), true);
    rows.forEach((r) => drawRow(r, false));
    doc.fillColor(COLORS.ink).moveDown(0.3);
  };

  /** A titled block with a status on the right and labelled lines underneath (one per test or sub-indicator). */
  const card = (title, status, statusColor, lines) => {
    const body = lines.filter(([, text]) => text);
    const bodyH = body.reduce((h, [, text]) => h + doc.heightOfString(clean(text), { width: W - 24, fontSize: 8.5, lineGap: 1.5 }) + 12, 0);
    room(24 + Math.min(bodyH, 90));
    const y = doc.y;
    doc.rect(M, y, W, 20).fill(COLORS.soft);
    doc.rect(M, y, 3, 20).fill(statusColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(clean(title), M + 10, y + 5.5, { width: W - 90, lineBreak: false, ellipsis: true });
    if (status) doc.font('Helvetica-Bold').fontSize(9).fillColor(statusColor).text(clean(status), M + W - 76, y + 5.5, { width: 68, align: 'right', lineBreak: false });
    doc.y = y + 24;
    for (const [label, text] of body) {
      if (label) doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text(clean(label).toUpperCase(), M + 10, doc.y, { width: W - 20 });
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(clean(text), M + 10, doc.y + 1, { width: W - 24, lineGap: 1.5 });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.25);
  };

  // ── Title band ──
  doc.rect(0, 0, doc.page.width, 92).fill(COLORS.band);
  doc.font('Helvetica').fontSize(9).fillColor('#bcd3da').text('KJET CO-INVESTMENT  |  EVALUATION REPORT', M, 24);
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#ffffff').text(clean(d.cluster_name), M, 40, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor('#dbe9ed')
    .text(clean(`${d.application_number}   |   ${d.county ?? ''}   |   ${(d.value_chain ?? '').replace(/_/g, ' ')}`), M, 66, { width: W });
  doc.y = 108;

  // ── Summary ──
  const score = d.score != null ? Math.round(d.score * 10) / 10 : null;
  const boxes = [
    [score != null ? `${score} / 100` : 'Not scored', 'Total score'],
    [d.band ?? 'Not scored', 'Decision band'],
    [d.eligibility ?? 'Not assessed', 'Eligibility'],
    [d.financial.result, 'Financial screening'],
  ];
  const bw = (W - 18) / 4;
  const by = doc.y;
  boxes.forEach(([value, label], i) => {
    const x = M + i * (bw + 6);
    const text = clean(value);
    doc.roundedRect(x, by, bw, 56, 4).fill(COLORS.soft);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, x + 8, by + 8, { width: bw - 16, lineBreak: false });
    // largest size at which the value fits on one line; otherwise the smallest size, wrapped onto two lines
    doc.font('Helvetica-Bold');
    const size = [14, 12, 10.5, 9.5].find((sz) => doc.fontSize(sz).widthOfString(text) <= bw - 16) ?? 9.5;
    doc.fontSize(size).fillColor(i === 2 ? statusTone(d.eligibility) : i === 3 ? statusTone(d.financial.result) : COLORS.ink)
      .text(text, x + 8, by + 23, { width: bw - 16, lineGap: 1 });
  });
  doc.y = by + 68;
  facts([
    ['Rank among eligible clusters', d.rank != null ? `${d.rank} of ${d.eligible_clusters}${d.county_rank ? ` (${d.county_rank} in ${d.county})` : ''}` : 'Not ranked (not eligible)'],
  ]);
  para('This report records the evaluation scores and findings. Selecting clusters for funding is a decision for MSEA.', { size: 8, color: COLORS.muted });

  // ── Figures the evaluation was made on, with Drive today beside them ──
  const f = d.financial_detail;
  h2('1. Application figures (as evaluated)');
  facts([
    ['Total project cost', kes(f.figures.total)],
    ['KJET grant requested', kes(f.figures.grant)],
    ['Cluster contribution', kes(f.figures.contribution)],
    ['Machinery subtotal', kes(f.figures.machinery)],
    ['Services subtotal', kes(f.figures.services)],
    ...(d.financial.drive.differs ? [['Application on Drive today', `cost ${kes(d.financial.drive.total)}, grant ${kes(d.financial.drive.grant)}, cash ${kes(d.financial.drive.contribution)}`, COLORS.hold]] : []),
    ['Members / women / youth', `${d.members ?? 'n/a'} / ${d.women ?? 'n/a'} / ${d.youth ?? 'n/a'}`],
    ['Jobs today / year 3 (applicant-reported)', `${d.jobs_today ?? 'n/a'} / ${d.jobs_year3 ?? 'n/a'}`],
  ]);

  // ── Financial screening ──
  h2('2. Financial screening (50-50 rule and category limits)');
  const c = f.checks;
  const yn = (v) => (v == null ? 'n/a' : v ? 'Yes' : 'No');
  table([{ title: 'Check', width: 3 }, { title: 'Result', width: 2 }, { title: 'Detail', width: 3 }], [
    ['Category (by KJET request)', { text: f.category, bold: true }, 'Category 1 up to KES 5M, Category 2 up to KES 32M'],
    ['Contribution plus grant', kes(c.contribution_plus_grant), `Difference from total: ${kes(c.total_minus_contribution_and_grant)}`],
    ['Total against machinery plus services', kes(c.total_minus_machinery_and_services), 'Difference should be within KES 100'],
    ['Arithmetic consistent', { text: yn(c.arithmetic_consistent), color: c.arithmetic_consistent ? COLORS.pass : COLORS.fail }, ''],
    ['Cluster share of total', pct(c.cluster_share), 'Minimum 50%'],
    ['KJET share of total', pct(c.kjet_share), 'Maximum 50%'],
    ['Meets 50% cash contribution', { text: yn(c.meets_50_percent_cash), color: c.meets_50_percent_cash ? COLORS.pass : COLORS.fail }, c.contribution_shortfall ? `Shortfall ${kes(c.contribution_shortfall)}` : ''],
    ['Maximum eligible grant', kes(c.max_eligible_grant), 'Lower of 50% of cost and KES 32M'],
    ['Grant above eligible maximum', kes(c.grant_above_max), ''],
    ['Category document check', c.document_check ?? 'n/a', 'Evaluator finding'],
  ]);
  facts([['Screening result', f.result, statusTone(f.result)]]);
  if (f.issues.length) {
    para('Issues identified', { bold: true });
    f.issues.forEach((t) => para(`-  ${t}`, { indent: 8 }));
  }
  if (d.evaluator_finance.note) { doc.moveDown(0.4); para(`Evaluator note: ${d.evaluator_finance.note}`, { size: 8.5, color: COLORS.muted }); }

  // ── Eligibility ──
  h2('3. Eligibility (tests E1 to E10)');
  d.eligibility_tests.forEach((t) => {
    card(`${t.test}  ${t.label}`, t.decision ?? 'Pending', tone(t.decision), [
      ['Data check', (() => { const h = (t.hint ?? '').split(/\r?\n/)[0]; return h.length > 260 ? `${h.slice(0, 257)}...` : h || null; })()],
      ["Assessor's note", t.note],
    ]);
  });
  facts([['Eligibility status', d.eligibility ?? 'Not assessed', statusTone(d.eligibility)]]);

  // ── Scorecard ──
  h2('4. Scorecard (weighted assessment)');
  table([{ title: 'Criterion', width: 6 }, { title: 'Weight', width: 1.1 }, { title: 'Rating (0-5)', width: 1.4 }, { title: 'Score', width: 1.2 }],
    [...d.criteria.map((k) => [`${k.code}  ${k.label}`, `${k.weight}`, k.rating != null ? String(k.rating) : 'n/a', k.score != null ? `${k.score} / ${k.weight}` : 'n/a']),
      [{ text: 'Total', bold: true }, { text: '100', bold: true }, '', { text: score != null ? `${score} / 100` : 'n/a', bold: true }]]);
  for (const k of d.criteria) {
    room(60);
    doc.moveDown(0.6);
    para(`${k.code}  ${k.label}   (${k.score ?? 'n/a'} of ${k.weight} points)`, { bold: true, color: COLORS.band });
    doc.moveDown(0.3);
    const noted = k.indicators.some((i) => i.note);
    k.indicators.forEach((i) => {
      const rt = i.rating == null ? COLORS.muted : i.rating >= 4 ? COLORS.pass : i.rating >= 3 ? COLORS.hold : COLORS.fail;
      card(`${i.code}  ${i.label}  (${i.weight}%)`, i.rating != null ? `${i.rating} / 5` : 'n/a', rt, noted ? [["Assessor's note", i.note]] : []);
    });
    if (!noted && k.justification) card('Justification', '', COLORS.muted, [[null, k.justification]]);
  }

  h2('5. Expert review');
  if (d.expert_remarks) para(d.expert_remarks);   // left empty until the sheet has remarks for this cluster
  else doc.moveDown(2);

  // ── Footer on every page ──
  const stamp = `Generated ${new Date().toISOString().slice(0, 10)}  |  Scores and findings: ${clean(d.source.file ?? 'evaluation sheet')}  |  Amounts: application data on Drive`;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;   // lets the footer sit below the text area without adding a page
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
      .text(`${stamp}   |   Confidential   |   Page ${i + 1} of ${range.count}`, M, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
  return { buffer: await done, filename: `KJET-evaluation-${d.application_number}.pdf` };
}
