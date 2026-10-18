/**
 * seed.js — Loads clusters_data.json into PostgreSQL (Phase 1 migration).
 * Run: node scripts/seed.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));

const JSON_PATH = process.env.CLUSTERS_JSON_PATH
  ? resolve(process.env.CLUSTERS_JSON_PATH)
  : resolve(__dir, '../../DASHBOARD SYSTEM/clusters_data.json');

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT)    || 5432,
  database: process.env.PGDATABASE || 'kjet',
  user:     process.env.PGUSER     || 'kjet_user',
  password: process.env.PGPASSWORD || 'kjet_pass',
});

function toDate(s) {
  return s && s !== '' ? s : null;
}

async function seedCluster(client, c) {
  // 1. Core cluster row
  const { rows: [row] } = await client.query(`
    INSERT INTO clusters (
      application_number, cluster_name, county, constituency, ward,
      legal_form, registration_date, value_chain, google_drive_folder,
      status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Submitted')
    ON CONFLICT (application_number) DO UPDATE SET
      cluster_name   = EXCLUDED.cluster_name,
      updated_at     = NOW()
    RETURNING id
  `, [
    c.application_number, c.cluster_name, c.county,
    c.constituency, c.ward, c.legal_form,
    toDate(c.registration_date), c.value_chain, c.google_drive_folder,
  ]);

  const id = row.id;

  // 2. Membership
  await client.query(`
    INSERT INTO cluster_membership (cluster_id, total_members, men, women, youth, pwd)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING
  `, [id, c.membership.total_members, c.membership.men,
      c.membership.women, c.membership.youth, c.membership.pwd]);

  // 3. Financials
  await client.query(`
    INSERT INTO cluster_financials (
      cluster_id, total_project_cost, machinery_subtotal, services_subtotal,
      cluster_contribution, grant_requested, section5_budget_total,
      cluster_share_pct, grant_share_pct, machinery_source, lead_time
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT DO NOTHING
  `, [
    id,
    c.financials.total_project_cost, c.financials.machinery_subtotal,
    c.financials.services_subtotal, c.financials.cluster_contribution,
    c.financials.grant_requested, c.financials.section5_budget_total,
    c.financials.cluster_share_pct, c.financials.grant_share_pct,
    c.machinery_source || null, c.lead_time || null,
  ]);

  // 4. Employment
  await client.query(`
    INSERT INTO cluster_employment (
      cluster_id, jobs_today, jobs_year1, jobs_year3
    ) VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING
  `, [id, c.employment.jobs_today, c.employment.jobs_year1, c.employment.jobs_year3]);

  // 5. Governance → contacts + banking
  const g = c.governance;
  await client.query(`
    INSERT INTO cluster_contacts (cluster_id, contact_type, full_name, position, phone, email)
    VALUES ($1,'authorized',$2,$3,$4,$5)
    ON CONFLICT DO NOTHING
  `, [id, g.rep_name, g.rep_position, g.phone, g.email]);

  await client.query(`
    INSERT INTO cluster_banking (cluster_id, bank_name, bank_account)
    VALUES ($1,$2,$3)
    ON CONFLICT DO NOTHING
  `, [id, g.bank_name, g.bank_account]);

  // 6. Business narrative (partial — investment_needs + business_description)
  await client.query(`
    INSERT INTO cluster_business (cluster_id, business_description, investment_needs)
    VALUES ($1,$2,$3)
    ON CONFLICT DO NOTHING
  `, [id, c.business_description || null, c.investment_needs || null]);

  // 7. Machinery items (parsed from machinery_proposed string)
  if (c.machinery_proposed) {
    const items = c.machinery_proposed
      .split(/\n|•/)
      .map((s) => s.replace(/^•?\s*/, '').trim())
      .filter(Boolean);
    for (let i = 0; i < items.length; i++) {
      await client.query(`
        INSERT INTO cluster_machinery (cluster_id, item_order, description)
        VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING
      `, [id, i + 1, items[i]]);
    }
  }
}

async function seed() {
  console.log('[seed] Reading cluster data...');
  const clusters = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  console.log(`[seed] Found ${clusters.length} clusters.`);

  const client = await pool.connect();
  let ok = 0; let fail = 0;
  try {
    for (const c of clusters) {
      try {
        await client.query('BEGIN');
        await seedCluster(client, c);
        await client.query('COMMIT');
        ok++;
        process.stdout.write(`\r[seed] ${ok}/${clusters.length} inserted...`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`\n[seed] ❌ Failed: ${c.application_number} — ${err.message}`);
        fail++;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n[seed] ✅ Done — ${ok} inserted, ${fail} failed.`);
}

seed().catch((err) => {
  console.error('[seed] Fatal:', err.message);
  process.exit(1);
});
