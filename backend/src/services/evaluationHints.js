/**
 * evaluationHints.js
 *
 * The Eligibility tab shows a "system hint" beside each test: a short line of facts the sheet worked out
 * (for example "Registered 3.8 yrs | Members: 80"). A formula in the sheet can break, and then every cluster carries the
 * same wrong line ("#REF!" for E5, "Registered 0.0 yrs" for E7). A hint is printed in the evaluation report, so it must
 * never show an error code or a figure that contradicts the sheet's own data.
 *
 * repairHint() keeps the hint as the sheet wrote it when it is sound. When it holds a spreadsheet error, or the E7 years
 * disagree with the registration date on the Register tab, the line is rebuilt from the sheet's other tabs (Register and
 * Financial_Screening) and the repair is returned so it can be logged. Nothing is invented: if the facts are not in the
 * sheet, the hint is left empty rather than wrong.
 */

const ERROR_TOKEN = /#(?:REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)/;
export const hasSheetError = (v) => typeof v === 'string' && ERROR_TOKEN.test(v);

/** Excel day number (46319 = 25 Oct 2026, with a fraction for the time) to milliseconds, or null. */
const serialMs = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 20000 && n < 80000 ? (n - 25569) * 86400000 : null;
};
const pct = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? `${(Number(v) * 100).toFixed(1)}%` : null);

/**
 * ctx = { regDate, appCreated }  (Register tab, as stored: day numbers or ISO text)
 *     + { clusterShare, kjetShare, meets50 }  (Financial_Screening tab)
 * Returns { hint, repaired } where repaired is a short description of what was changed, or null.
 */
export function repairHint(test, hint, ctx = {}) {
  const text = hint == null ? null : String(hint);

  if (test === 'E5' && (text == null || hasSheetError(text))) {
    const parts = [];
    if (pct(ctx.clusterShare)) parts.push(`Cluster share: ${pct(ctx.clusterShare)}`);
    if (pct(ctx.kjetShare)) parts.push(`KJET share: ${pct(ctx.kjetShare)}`);
    if (ctx.meets50) parts.push(`Meets 50% cash contribution: ${ctx.meets50}`);
    return { hint: parts.length ? parts.join(' | ') : null, repaired: `E5 hint was ${text ?? 'empty'}; rebuilt from Financial_Screening` };
  }

  if (test === 'E7' && text && /^Registered\s+[\d.]+\s*yrs?/i.test(text)) {
    const reg = serialMs(ctx.regDate) ?? (ctx.regDate ? Date.parse(ctx.regDate) : null);
    const ref = serialMs(ctx.appCreated) ?? (ctx.appCreated ? Date.parse(ctx.appCreated) : null);
    if (reg != null && !Number.isNaN(reg) && ref != null && !Number.isNaN(ref) && ref >= reg) {
      const years = ((ref - reg) / (365.25 * 86400000)).toFixed(1);
      const shown = text.match(/^Registered\s+([\d.]+)/i)[1];
      if (Math.abs(Number(shown) - Number(years)) > 0.15) {
        return { hint: text.replace(/^Registered\s+[\d.]+\s*yrs?/i, `Registered ${years} yrs`), repaired: `E7 hint said ${shown} yrs; the registration date gives ${years}` };
      }
    }
    return { hint: text, repaired: null };
  }

  if (text && hasSheetError(text)) {
    const stripped = text.split('|').map((p) => p.trim()).filter((p) => p && !hasSheetError(p)).join(' | ');
    return { hint: stripped || null, repaired: `${test} hint held a spreadsheet error (${text.match(ERROR_TOKEN)[0]}); removed` };
  }
  return { hint: text, repaired: null };
}
