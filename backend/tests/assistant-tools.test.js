/**
 * Accuracy test for the assistant's lookup tools. No AI involved: every tool result is
 * compared with an independent raw SQL query. Run: node tests/assistant-tools.test.js
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { toolImpl } from '../src/services/assistantTools.js';

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' | ' + detail}`);
  ok ? passed++ : failed++;
};
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

// 1. Whole-portfolio totals
{
  const t = (await toolImpl.portfolio_stats({})).totals;
  const [r] = await q(`SELECT COUNT(*)::int n, SUM(COALESCE(ev.eval_total_cost, f.total_project_cost)) cost, SUM(COALESCE(ev.eval_grant_requested, f.grant_requested)) g FROM clusters c LEFT JOIN cluster_financials f ON f.cluster_id=c.id LEFT JOIN cluster_evaluation ev ON ev.application_number=c.application_number`);
  // membership totals are the portal register's figures where the sheet has them (as the selection report totals them), otherwise the application's
  const [mm] = await q(`SELECT SUM(COALESCE(ev.portal_men + ev.portal_women, m.total_members))::int m, SUM(COALESCE(ev.portal_women, m.women))::int w FROM cluster_membership m JOIN clusters c ON c.id = m.cluster_id LEFT JOIN cluster_evaluation ev ON ev.application_number = c.application_number`);
  // jobs totals leave out an application reporting more than 5,000 jobs (not plausible: one cluster reported 4,000,000)
  const [jj] = await q(`SELECT SUM(jobs_year3) FILTER (WHERE GREATEST(jobs_today, jobs_year1, jobs_year3) <= 5000)::int j, COUNT(*) FILTER (WHERE GREATEST(jobs_today, jobs_year1, jobs_year3) > 5000)::int ex FROM cluster_employment`);
  check('cluster count', t.clusters === r.n, `${t.clusters} vs ${r.n}`);
  check('total project cost', Number(t.total_project_cost) === Number(r.cost));
  check('grant total', Number(t.grant_requested) === Number(r.g));
  check('members total', t.total_members === mm.m);
  check('women total', t.women === mm.w);
  check('jobs year 3 total', t.jobs_year3 === jj.j);
  check('implausible jobs figures are counted, not summed', t.jobs_excluded_applications === jj.ex && jj.ex >= 1, `${t.jobs_excluded_applications} vs ${jj.ex}`);
}
// 2. Group by county sums to the whole
{
  const g = (await toolImpl.portfolio_stats({ group_by: 'county' })).groups;
  const sum = g.reduce((a, x) => a + x.clusters, 0);
  const [r] = await q('SELECT COUNT(*)::int n FROM clusters');
  check('county groups sum to total clusters', sum === r.n, `${sum} vs ${r.n}`);
  const [one] = await q(`SELECT county, COUNT(*)::int n FROM clusters GROUP BY county ORDER BY n DESC, county LIMIT 1`);
  check('largest county matches', g[0].group_name === one.county && g[0].clusters === one.n);
}
// 3. Compliance counts
{
  const g = (await toolImpl.portfolio_stats({ group_by: 'compliance_status' })).groups;
  const rows = await q(`SELECT compliance_status s, COUNT(*)::int n FROM cluster_financials GROUP BY 1`);
  for (const r of rows) check(`compliance "${r.s}" = ${r.n}`, g.find((x) => x.group_name === r.s)?.clusters === r.n);
}
// 4. Search + filters
{
  const [c] = await q(`SELECT county FROM clusters LIMIT 1`);
  const s = await toolImpl.search_clusters({ county: c.county, limit: 50 });
  const [r] = await q(`SELECT COUNT(*)::int n FROM clusters WHERE county ILIKE $1`, [c.county]);
  check('county search total', s.total_matching === r.n);
  check('county search rows all in county', s.clusters.every((x) => x.county.toLowerCase() === c.county.toLowerCase()));
  const none = await toolImpl.search_clusters({ text: 'zzzz-no-such-cluster' });
  check('no match returns zero, no invention', none.total_matching === 0 && none.clusters.length === 0);
}
// 5. Ranking
{
  const r = await toolImpl.rank_clusters({ metric: 'total_project_cost', limit: 3 });
  const rows = await q(`SELECT c.application_number a FROM clusters c JOIN cluster_financials f ON f.cluster_id=c.id ORDER BY f.total_project_cost DESC NULLS LAST, c.cluster_name LIMIT 3`);
  check('top 3 by cost', JSON.stringify(r.clusters.map((x) => x.application_number)) === JSON.stringify(rows.map((x) => x.a)));
  const bad = await toolImpl.rank_clusters({ metric: 'DROP TABLE clusters' });
  check('unknown metric rejected', !!bad.error);
}
// 6. Full cluster detail for every cluster: sub-tables belong to that cluster
{
  const all = await q('SELECT application_number a, id FROM clusters ORDER BY id');
  let bad = 0;
  for (const { a, id } of all) {
    const d = (await toolImpl.get_cluster({ application_number: a })).cluster;
    const [mach] = await q('SELECT COUNT(*)::int n FROM cluster_machinery WHERE cluster_id=$1', [id]);
    const [con] = await q('SELECT COUNT(*)::int n FROM cluster_contacts WHERE cluster_id=$1', [id]);
    if (d.application_number !== a || d.machinery.length !== mach.n || d.contacts.length !== con.n) bad++;
  }
  check(`get_cluster correct for all ${all.length} clusters`, bad === 0, `${bad} mismatches`);
  const nf = await toolImpl.get_cluster({ application_number: 'KJET-0000-000000' });
  check('unknown cluster -> found:false', nf.found === false);
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
await pool.end();
process.exit(failed ? 1 : 0);
