/**
 * reseed-failed.js — Re-seeds specific clusters that failed the first time.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const { Pool } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = resolve(__dir, '../../src/data/clusters.json');

const RETRY = ['KJET-2026-162976', 'KJET-2026-043299'];

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'kjet',
  user: process.env.PGUSER || 'kjet_user',
  password: process.env.PGPASSWORD || 'kjet_pass',
});

async function run() {
  const all = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  const targets = all.filter(c => RETRY.includes(c.application_number));
  const client = await pool.connect();

  for (const c of targets) {
    try {
      await client.query('BEGIN');

      const { rows: [row] } = await client.query(`
        INSERT INTO clusters (
          application_number, cluster_name, county, constituency, ward,
          legal_form, registration_date, value_chain, google_drive_folder, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Submitted')
        ON CONFLICT (application_number) DO UPDATE SET
          value_chain  = EXCLUDED.value_chain,
          constituency = EXCLUDED.constituency,
          ward         = EXCLUDED.ward,
          updated_at   = NOW()
        RETURNING id
      `, [c.application_number, c.cluster_name, c.county, c.constituency,
          c.ward, c.legal_form, c.registration_date || null,
          c.value_chain, c.google_drive_folder]);

      const id = row.id;

      await client.query(`INSERT INTO cluster_membership (cluster_id,total_members,men,women,youth,pwd) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [id, c.membership.total_members, c.membership.men, c.membership.women, c.membership.youth, c.membership.pwd]);

      await client.query(`INSERT INTO cluster_financials (cluster_id,total_project_cost,machinery_subtotal,services_subtotal,cluster_contribution,grant_requested,section5_budget_total,cluster_share_pct,grant_share_pct,machinery_source,lead_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [id, c.financials.total_project_cost, c.financials.machinery_subtotal, c.financials.services_subtotal,
         c.financials.cluster_contribution, c.financials.grant_requested, c.financials.section5_budget_total,
         c.financials.cluster_share_pct, c.financials.grant_share_pct,
         c.machinery_source || null, c.lead_time || null]);

      await client.query(`INSERT INTO cluster_employment (cluster_id,jobs_today,jobs_year1,jobs_year3) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, c.employment.jobs_today, c.employment.jobs_year1, c.employment.jobs_year3]);

      await client.query(`INSERT INTO cluster_contacts (cluster_id,contact_type,full_name,position,phone,email) VALUES ($1,'authorized',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [id, c.governance.rep_name, c.governance.rep_position, c.governance.phone, c.governance.email]);

      await client.query(`INSERT INTO cluster_banking (cluster_id,bank_name,bank_account) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, c.governance.bank_name, c.governance.bank_account]);

      await client.query(`INSERT INTO cluster_business (cluster_id,business_description,investment_needs) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, c.business_description || null, c.investment_needs || null]);

      await client.query('COMMIT');
      console.log(`✅ Re-seeded: ${c.application_number} — ${c.cluster_name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ Failed: ${c.application_number} — ${err.message}`);
    }
  }

  client.release();
  await pool.end();
}

run().catch(err => { console.error(err.message); process.exit(1); });
