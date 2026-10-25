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
    doc.roundedRect(x, by, bw, 50, 4).fill(COLORS.soft);
    doc.font('Helvetica-Bold').fontSize(i < 2 ? 13 : 10).fillColor(i === 2 ? statusTone(d.eligibility) : i === 3 ? statusTone(d.financial.result) : COLORS.ink)
      .text(clean(value), x + 8, by + 9, { width: bw - 16 });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, x + 8, by + 34, { width: bw - 16 });
  });
  doc.y = by + 62;
  facts([
    ['Rank among eligible clusters', d.rank != null ? `${d.rank} of ${d.eligible_clusters}${d.county_rank ? ` (${d.county_rank} in ${d.county})` : ''}` : 'Not ranked (not eligible)'],
    ['Grant-ready', d.grant_ready ? `Yes, number ${d.grant_ready_rank} on the list (eligible and scored 70 or more)` : 'No (a cluster is grant-ready when eligibility is PASS and the score is 70 or more)'],
  ]);
  para('Recommended clusters remain subject to due diligence, environmental and social clearance, and World Bank no-objection.', { size: 8, color: COLORS.muted });

  // ── Application figures (Drive) ──
  const f = d.financial_detail;
  h2('1. Application figures (from the application on Drive)');
  facts([
    ['Total project cost', kes(f.figures.total)],
    ['KJET grant requested', kes(f.figures.grant)],
    ['Cluster contribution', kes(f.figures.contribution)],
    ['Machinery subtotal', kes(f.figures.machinery)],
    ['Services subtotal', kes(f.figures.services)],
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
  table([{ title: 'Test', width: 3 }, { title: 'Decision', width: 1.3 }, { title: 'What the data showed', width: 5 }],
    d.eligibility_tests.map((t) => [`${t.test}  ${t.label}`, { text: t.decision ?? 'Pending', bold: true, color: tone(t.decision) }, (t.hint ?? '').split('\n')[0].slice(0, 220)]));
  facts([['Eligibility status', d.eligibility ?? 'Not assessed', statusTone(d.eligibility)]]);
  if (d.eligibility_reasons) {
    doc.moveDown(0.4);
    para('Assessment notes', { bold: true });
    para(d.eligibility_reasons.replace(/\s(E(?:10|[1-9]) \((?:Pass|Hold|Fail)\):)/g, '\n$1'), { size: 8.5 });
  }

  // ── Scorecard ──
  h2('4. Scorecard (weighted assessment)');
  table([{ title: 'Criterion', width: 6 }, { title: 'Weight', width: 1.1 }, { title: 'Rating (0-5)', width: 1.4 }, { title: 'Score', width: 1.2 }],
    [...d.criteria.map((k) => [`${k.code}  ${k.label}`, `${k.weight}`, k.rating != null ? String(k.rating) : 'n/a', k.score != null ? `${k.score} / ${k.weight}` : 'n/a']),
      [{ text: 'Total', bold: true }, { text: '100', bold: true }, '', { text: score != null ? `${score} / 100` : 'n/a', bold: true }]]);
  for (const k of d.criteria) {
    room(70);
    doc.moveDown(0.5);
    para(`${k.code}  ${k.label}   (${k.score ?? 'n/a'} of ${k.weight})`, { bold: true, color: COLORS.band });
    table([{ title: 'Sub-indicator', width: 7 }, { title: 'Weight in criterion', width: 1.6 }, { title: 'Rating', width: 1 }],
      k.indicators.map((i) => [`${i.code}  ${i.label}`, `${i.weight}%`, i.rating != null ? String(i.rating) : 'n/a']));
    if (k.justification) {
      para('Justification', { bold: true, size: 8.5 });
      para(k.justification.replace(/\s(C[1-6]\.\d \(\d\):)/g, '\n$1'), { size: 8.5 });
    }
  }

  if (d.expert_remarks || d.moderation_note) {
    h2('5. Expert review');
    if (d.expert_remarks) para(d.expert_remarks);
    if (d.moderation_note) { doc.moveDown(0.3); para(`Moderation note: ${d.moderation_note}`, { size: 8.5, color: COLORS.muted }); }
  }

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
