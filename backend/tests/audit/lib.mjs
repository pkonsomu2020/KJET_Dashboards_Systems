/** Shared helpers for the Cohort 1 audit scripts: sign in to a running dashboard and read its API. Read-only. */
import 'dotenv/config';

export const BASE = (process.env.AUDIT_BASE ?? process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');

export async function login() {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: process.env.AUDIT_ORIGIN ?? BASE },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error(`Sign-in to ${BASE} failed (HTTP ${r.status})`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

export const api = async (path, cookie) => {
  const r = await fetch(BASE + path, { headers: { Cookie: cookie, Origin: process.env.AUDIT_ORIGIN ?? BASE } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

/** Collects checks by group and prints one line per group, then examples of every difference. */
export function makeChecker() {
  const groups = new Map();
  const check = (group, ok, detail = '') => {
    const g = groups.get(group) ?? { n: 0, bad: [] };
    g.n++; if (!ok) g.bad.push(detail);
    groups.set(group, g);
  };
  const report = (title) => {
    let total = 0, bad = 0;
    const w = Math.max(10, ...[...groups.keys()].map((k) => k.length));
    for (const [k, g] of groups) {
      total += g.n; bad += g.bad.length;
      console.log(`${g.bad.length ? 'FAIL' : 'ok  '}  ${k.padEnd(w)}  ${String(g.n).padStart(5)} checks${g.bad.length ? `, ${g.bad.length} differ` : ''}`);
    }
    console.log(`\n${title}: ${total - bad} of ${total} checks agree, ${bad} differ`);
    if (bad) { console.log('\nDifferences:'); for (const [k, g] of groups) g.bad.slice(0, 12).forEach((d) => console.log(`  [${k}] ${d}`)); }
    return bad;
  };
  return { check, report };
}
