/**
 * applicationSync.js
 *
 * Writes the contents of a cluster's Drive "application_details.csv" into PostgreSQL.
 * Drive is the single source of truth: every value present in the file REPLACES what the
 * database holds. Nothing is guessed from PDFs or inferred. Fields the CSV does not contain
 * (business_description, investment_needs, machinery_source, lead_time) are left untouched.
 * Every changed scalar value is recorded in drive_sync_log.
 */
import { num, text } from './applicationCsv.js';

const SCALAR_TABLES = ['clusters', 'cluster_membership', 'cluster_financials', 'cluster_employment', 'cluster_banking'];

let schemaReady = null;

/** Runs the schema additions once per process, outside any transaction (parallel syncs would deadlock). */
export function ensureSyncSchemaOnce(pool) {
  if (!schemaReady) schemaReady = ensureSyncSchema(pool).catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

async function ensureSyncSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS drive_sync_log (
      id                 SERIAL PRIMARY KEY,
      cluster_id         INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
      application_number VARCHAR(30),
      table_name         TEXT,
      field              TEXT,
      old_value          TEXT,
      new_value          TEXT,
      synced_at          TIMESTAMPTZ DEFAULT NOW()
    )`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_drive_sync_log_cluster ON drive_sync_log(cluster_id, synced_at DESC)');
  await client.query('ALTER TABLE cluster_buyers ADD COLUMN IF NOT EXISTS unit_price NUMERIC');

  // Parts of the application that were not kept before: the declaration, the commitments, the activity plan and the vehicle justifications
  await client.query(`
    ALTER TABLE clusters
      ADD COLUMN IF NOT EXISTS organization_name        TEXT,
      ADD COLUMN IF NOT EXISTS declaration_name         TEXT,
      ADD COLUMN IF NOT EXISTS declaration_position     TEXT,
      ADD COLUMN IF NOT EXISTS declaration_date         DATE,
      ADD COLUMN IF NOT EXISTS declaration_acknowledged BOOLEAN,
      ADD COLUMN IF NOT EXISTS commitments_ticked       INTEGER,
      ADD COLUMN IF NOT EXISTS commitments_total        INTEGER`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cluster_activities (
      id         SERIAL PRIMARY KEY,
      cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
      item_order SMALLINT,
      activity   TEXT,
      months     TEXT
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS cluster_vehicles (
      id         SERIAL PRIMARY KEY,
      cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
      item_order SMALLINT,
      details    TEXT
    )`);

  // Every file in every section folder, with its extracted text
  await client.query(`
    ALTER TABLE cluster_documents
      ADD COLUMN IF NOT EXISTS file_id           TEXT,
      ADD COLUMN IF NOT EXISTS mime_type         TEXT,
      ADD COLUMN IF NOT EXISTS size_bytes        BIGINT,
      ADD COLUMN IF NOT EXISTS modified_time     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS md5               TEXT,
      ADD COLUMN IF NOT EXISTS content_text      TEXT,
      ADD COLUMN IF NOT EXISTS content_status    TEXT,
      ADD COLUMN IF NOT EXISTS content_error     TEXT,
      ADD COLUMN IF NOT EXISTS content_chars     INTEGER,
      ADD COLUMN IF NOT EXISTS content_parsed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS extractor_version TEXT`);
  await client.query('ALTER TABLE cluster_documents ALTER COLUMN section TYPE TEXT');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_cluster_documents_file ON cluster_documents(cluster_id, file_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_cluster_documents_status ON cluster_documents(content_status)');
  // Some applications type large numbers into "contract years"; store what Drive says instead of failing.
  await client.query('ALTER TABLE cluster_buyers ALTER COLUMN contract_years TYPE INTEGER');
}

// ── helpers ──────────────────────────────────────────────────

const yesNo = (v) => (v == null ? null : /^(yes|true|y|1)$/i.test(v.trim()) ? true : /^(no|false|n|0)$/i.test(v.trim()) ? false : null);
const trunc = (v, n) => (v == null ? null : String(v).slice(0, n));
const intOrNull = (v) => (v == null ? null : Math.round(v));
const hasAny = (obj) => Object.values(obj).some((v) => v !== null && v !== undefined);

/** UPDATE the single row for a cluster, or INSERT it. Extra duplicate rows are removed. */
async function putOne(client, table, clusterId, values) {
  const cols = Object.keys(values);
  const { rows } = await client.query(`SELECT id FROM ${table} WHERE cluster_id = $1 ORDER BY id`, [clusterId]);
  if (rows.length) {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await client.query(`UPDATE ${table} SET ${sets} WHERE id = $${cols.length + 1}`, [...cols.map((c) => values[c]), rows[0].id]);
    if (rows.length > 1) {
      await client.query(`DELETE FROM ${table} WHERE cluster_id = $1 AND id <> $2`, [clusterId, rows[0].id]);
    }
  } else {
    const ph = cols.map((_, i) => `$${i + 2}`).join(', ');
    await client.query(`INSERT INTO ${table} (cluster_id, ${cols.join(', ')}) VALUES ($1, ${ph})`, [clusterId, ...cols.map((c) => values[c])]);
  }
}

/** Replaces all rows of a list table for the cluster. */
async function replaceRows(client, table, clusterId, rows) {
  await client.query(`DELETE FROM ${table} WHERE cluster_id = $1`, [clusterId]);
  for (const row of rows) {
    const cols = Object.keys(row);
    const ph = cols.map((_, i) => `$${i + 2}`).join(', ');
    await client.query(`INSERT INTO ${table} (cluster_id, ${cols.join(', ')}) VALUES ($1, ${ph})`, [clusterId, ...cols.map((c) => row[c])]);
  }
}

async function snapshot(client, clusterId) {
  const out = {};
  for (const t of SCALAR_TABLES) {
    const col = t === 'clusters' ? 'id' : 'cluster_id';
    const { rows } = await client.query(`SELECT * FROM ${t} WHERE ${col} = $1 ORDER BY id LIMIT 1`, [clusterId]);
    out[t] = rows[0] ?? {};
  }
  return out;
}

const IGNORE = new Set(['id', 'cluster_id', 'created_at', 'updated_at']);
const show = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

// ── main entry ───────────────────────────────────────────────

/**
 * @param client  a pg client already inside BEGIN
 * @param cluster { id, application_number }
 * @param f       Map from parseApplicationCsv
 * @returns       { changes } number of changed scalar fields
 */
export async function applyApplicationCsv(client, cluster, f) {
  const cid = cluster.id;
  const n = (l) => num(f, l);
  const t = (l) => text(f, l);
  // Numbered lists ("Machinery 41 desc", "Buyer 6 name") can run to any length: read up to the highest number present, never a fixed cap
  const maxIndex = (label) => {
    let max = 0;
    for (const k of f.keys()) {
      if (!k.startsWith(`${label} `)) continue;
      const first = k.slice(label.length + 1).split(' ')[0];
      if (/^\d+$/.test(first)) max = Math.max(max, Number(first));
    }
    return max;
  };

  if (t('Application No.') !== cluster.application_number) {
    throw new Error(`CSV is for ${t('Application No.')}, not ${cluster.application_number}`);
  }
  const before = await snapshot(client, cid);

  // 1. clusters (core identity)
  const cl = {
    status: trunc(t('Status'), 20),
    submitted_at: t('Submitted At'),
    created_at_mis: t('Created At'),
    cluster_name: t('Cluster name') ?? t('Cluster Name'),
    legal_form: trunc(t('Cluster legal form'), 50),
    registration_date: t('Cluster registration date'),
    physical_address: t('Cluster physical address'),
    county: t('Cluster county') ?? t('County'),
    constituency: t('Constituency'),
    ward: t('Ward'),
    value_chain: t('Value Chain'),
    phone: trunc(t('Cluster phone'), 30),
    email: trunc(t('Cluster email'), 150),
    insurance: t('Cluster insurance'),
    signatories: t('Cluster signatories'),
    executives_ownership: t('Executives ownership'),
    prior_funding: t('Prior funding'),
    current_applications: yesNo(t('Current applications')),
    current_applications_detail: t('Current applications details'),
    vision: t('Cluster vision'),
    mission: t('Cluster mission'),
    goal_1: t('Goal 1'), goal_2: t('Goal 2'), goal_3: t('Goal 3'), goal_4: t('Goal 4'), goal_5: t('Goal 5'),
    organization_name: t('Organization Name'),
    declaration_name: t('Authorized declaration name'), declaration_position: t('Authorized declaration position'),
    declaration_date: t('Authorized declaration date'), declaration_acknowledged: /^(on|yes|true)$/i.test(t('Declaration acknowledged') ?? '') ? true : (t('Declaration acknowledged') ? false : null),
    commitments_ticked: [...f.keys()].filter((k) => /^Commitment \d+$/.test(k) && /^(on|yes|true)$/i.test(t(k) ?? '')).length,
    commitments_total: [...f.keys()].filter((k) => /^Commitment \d+$/.test(k)).length,
  };
  // NOT NULL columns must never be blanked
  for (const k of ['cluster_name', 'county', 'value_chain']) if (cl[k] == null) delete cl[k];
  const setCols = Object.keys(cl);
  await client.query(
    `UPDATE clusters SET ${setCols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
    [cid, ...setCols.map((c) => cl[c])],
  );

  // 2. contacts + banking
  const contact = (type, p) => ({
    contact_type: type,
    full_name: t(`${p} name`), position: t(`${p} position`), id_number: trunc(t(`${p} id number`), 30),
    phone: trunc(t(`${p} phone`), 30), email: trunc(t(`${p} email`), 150),
  });
  const contacts = [contact('authorized', 'Authorized'), contact('manager', 'Project manager')]
    .filter((c) => c.full_name || c.phone || c.email || c.id_number);
  await replaceRows(client, 'cluster_contacts', cid, contacts);
  await putOne(client, 'cluster_banking', cid, { bank_name: t('Cluster bank name'), bank_account: trunc(t('Cluster bank account'), 60) });

  // 3. membership (blank = 0, as the form leaves zero blank)
  const men = n('Total members men') ?? 0;
  const women = n('Total members women') ?? 0;
  await putOne(client, 'cluster_membership', cid, {
    men, women, youth: n('Total members youth') ?? 0, pwd: n('Total members pwd') ?? 0, total_members: men + women,
  });

  // 4. financials
  const totalCost = n('Total project cost');
  const grant = n('Grant requested');
  const contrib = n('Cluster contribution');
  const pct = (v) => (totalCost && v != null ? Math.round((v / totalCost) * 10000) / 100 : null);
  await putOne(client, 'cluster_financials', cid, {
    total_project_cost: totalCost, machinery_subtotal: n('Machinery subtotal'), services_subtotal: n('Services subtotal'),
    cluster_contribution: contrib, grant_requested: grant,
    cluster_share_pct: pct(contrib), grant_share_pct: pct(grant),
    has_vehicles: yesNo(t('Has vehicles')), implementation_timeline: t('Implementation timeline'),
    problem_addressed: t('Problem addressed'), without_grant_alternative: t('Without grant alternative'), why_now: t('Why now'),
    section5_budget_total: n('Budget total'),
    budget_productive_assets: n('Budget productive assets'), budget_productive_assets_pct: n('Budget productive assets pct'),
    budget_services: n('Budget services'), budget_services_pct: n('Budget services pct'),
    budget_working_capital: n('Budget working capital'), budget_working_capital_pct: n('Budget working capital pct'),
    budget_land_buildings: n('Budget land buildings'), budget_land_buildings_pct: n('Budget land buildings pct'),
    budget_preop_expenses: n('Budget preop expenses'), budget_preop_expenses_pct: n('Budget preop expenses pct'),
    capacity_ability_explanation: t('Capacity ability explanation'),
    payback_period_years: n('Machinery payback period'), payback_period_notes: t('Machinery payback period notes'),
    irr_pct: n('Machinery irr'), irr_notes: t('Machinery irr notes'),
    npv_kes: n('Machinery npv'), npv_notes: t('Machinery npv notes'),
    key_assumption_1: t('Key assumption 1'), key_assumption_2: t('Key assumption 2'), key_assumption_3: t('Key assumption 3'),
    key_assumption_4: t('Key assumption 4'), key_assumption_5: t('Key assumption 5'),
  });

  // 5. employment
  await putOne(client, 'cluster_employment', cid, {
    jobs_today: intOrNull(n('Jobs today')), jobs_year1: intOrNull(n('Jobs year1')), jobs_year3: intOrNull(n('Jobs year3')),
    jobs_women_today: intOrNull(n('Jobs women today')), jobs_women_year1: intOrNull(n('Jobs women year1')), jobs_women_year3: intOrNull(n('Jobs women year3')),
    jobs_youth_today: intOrNull(n('Jobs youth today')), jobs_youth_year1: intOrNull(n('Jobs youth year1')), jobs_youth_year3: intOrNull(n('Jobs youth year3')),
    jobs_pwd_today: intOrNull(n('Jobs pwd today')), jobs_pwd_year1: intOrNull(n('Jobs pwd year1')), jobs_pwd_year3: intOrNull(n('Jobs pwd year3')),
    income_today: n('Income today'), income_year1: n('Income year1'), income_year3: n('Income year3'),
    income_assumptions: t('Jobs income assumptions'),
  });

  // 6. business narrative (description/needs are NOT in the CSV and are preserved)
  await putOne(client, 'cluster_business', cid, {
    market_geography: t('Market geography'), market_size: t('Market size'),
    competitor_1: t('Competitor 1'), competitor_2: t('Competitor 2'), competitor_3: t('Competitor 3'),
    pricing_method: t('Pricing method'), pricing_changes: t('Pricing changes'), production_process: t('Production process'),
    installed_capacity: n('Installed capacity'), installed_capacity_unit: trunc(t('Installed capacity unit'), 50),
    current_output: n('Current output'), current_output_unit: trunc(t('Current output unit'), 50),
    capacity_utilisation_pct: n('Capacity utilisation'), main_bottleneck: t('Main bottleneck'),
  });

  // 7. impact
  await putOne(client, 'cluster_impact', cid, {
    daily_output_today: n('Daily output today'), daily_output_after: n('Daily output after'), daily_output_pct: n('Daily output percent'),
    capacity_today_pct: n('Capacity today'), capacity_after_pct: n('Capacity after'),
    reject_rate_today: n('Reject rate today'), reject_rate_after: n('Reject rate after'),
    energy_today: n('Energy today'), energy_after: n('Energy after'),
    labour_today: n('Labour today'), labour_after: n('Labour after'),
    quality_today: t('Quality today'), quality_after: t('Quality after'),
    sales_uplift_y1_units: n('Sales uplift y1 units'), sales_uplift_y1_revenue: n('Sales uplift y1 revenue'), sales_uplift_y1_assumptions: t('Sales uplift y1 assumptions'),
    sales_uplift_y2_units: n('Sales uplift y2 units'), sales_uplift_y2_revenue: n('Sales uplift y2 revenue'), sales_uplift_y2_assumptions: t('Sales uplift y2 assumptions'),
    sales_uplift_y3_units: n('Sales uplift y3 units'), sales_uplift_y3_revenue: n('Sales uplift y3 revenue'), sales_uplift_y3_assumptions: t('Sales uplift y3 assumptions'),
    impact_local_sourcing: t('Impact local sourcing'), impact_skills_transfer: t('Impact skills transfer'),
    impact_environmental: t('Impact environmental'), impact_food_security: t('Impact food security'), impact_other: t('Impact other'),
  });

  // 8. sustainability
  await putOne(client, 'cluster_sustainability', cid, { sustainability_plan: t('Sustainability plan') });

  // 9. list tables
  const products = [];
  for (let i = 1; i <= Math.max(8, maxIndex('Product')); i++) {
    const name = t(`Product ${i} name`);
    if (!name) continue;
    products.push({ product_order: i, product_name: name, unit: trunc(t(`Product ${i} unit`), 50), price_kes: n(`Product ${i} price`), active_months: t(`Product ${i} months`) });
  }
  await replaceRows(client, 'cluster_products', cid, products);

  const buyers = [];
  for (let i = 1; i <= Math.max(8, maxIndex('Buyer')); i++) {
    const name = t(`Buyer ${i} name`);
    if (!name) continue;
    buyers.push({
      buyer_order: i, buyer_name: name, buyer_type: trunc(t(`Buyer ${i} type`), 50),
      annual_volume: n(`Buyer ${i} volume`), unit_price: n(`Buyer ${i} price`), contract_years: intOrNull(n(`Buyer ${i} years`)),
    });
  }
  await replaceRows(client, 'cluster_buyers', cid, buyers);

  const lines = (_kind, label) => {
    const out = [];
    for (let i = 1; i <= Math.max(40, maxIndex(label)); i++) {
      const desc = t(`${label} ${i} desc`);
      const total = n(`${label} ${i} total cost`);
      if (!desc && !total) continue;
      out.push({ item_order: i, description: desc, quantity: n(`${label} ${i} qty`), unit_cost_kes: n(`${label} ${i} unit cost`), total_cost_kes: total });
    }
    return out;
  };
  await replaceRows(client, 'cluster_machinery', cid, lines('machinery', 'Machinery'));
  await replaceRows(client, 'cluster_services', cid, lines('services', 'Service'));

  // implementation activities (with the months each runs) and the vehicle justifications
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const activities = [];
  for (let i = 1; i <= Math.max(12, maxIndex('Activity')); i++) {
    const name = t(`Activity ${i}`);
    if (!name) continue;
    activities.push({ item_order: i, activity: name, months: MONTHS.filter((m) => t(`Activity ${i} ${m}`)).join(',') });
  }
  await replaceRows(client, 'cluster_activities', cid, activities);
  const vehicles = [];
  for (let i = 1; i <= Math.max(5, maxIndex('Vehicle')); i++) {
    const details = t(`Vehicle ${i} details`);
    if (details) vehicles.push({ item_order: i, details });
  }
  await replaceRows(client, 'cluster_vehicles', cid, vehicles);

  const quotes = [];
  for (let i = 1; i <= Math.max(30, maxIndex('Item')); i++) {
    const name = t(`Item ${i} name`);
    if (!name) continue;
    quotes.push({
      item_order: i, item_name: name, quote_1: n(`Item ${i} quote1`), quote_2: n(`Item ${i} quote2`), quote_3: n(`Item ${i} quote3`),
      supplier: t(`Item ${i} supplier`), selected_price: n(`Item ${i} selected price`), selection_reason: t(`Item ${i} reason`),
    });
  }
  await replaceRows(client, 'cluster_quotations', cid, quotes);

  const pl = [];
  const plMetrics = { revenue: 'revenue', cogs: 'cogs', gross_profit: 'gross profit', salaries: 'salaries', rent: 'rent', marketing: 'marketing', other_opex: 'other opex', ebitda: 'ebitda', depreciation: 'depreciation', net_profit: 'net profit' };
  for (const y of [1, 2, 3]) {
    const row = { year: y };
    for (const [col, label] of Object.entries(plMetrics)) {
      row[`${col}_without`] = n(`Pl ${label} y${y} without`);
      row[`${col}_with`] = n(`Pl ${label} y${y} with`);
    }
    if (hasAny({ ...row, year: null })) pl.push(row);
  }
  await replaceRows(client, 'cluster_pl', cid, pl);

  const cash = [];
  for (let m = 1; m <= 12; m++) {
    const row = {
      year: 1, month: m,
      opening_cash_balance: n(`Cashflow y1 opening cash balance m${m}`), sales_inflows: n(`Cashflow y1 sales inflows m${m}`),
      equipment_payments: n(`Cashflow y1 equipment payments m${m}`), closing_cash_balance: n(`Cashflow y1 closing cash balance m${m}`),
    };
    if (hasAny({ ...row, year: null, month: null })) cash.push(row);
  }
  for (const y of [2, 3]) {
    const row = {
      year: y, month: null,
      opening_cash_balance: n(`Cashflow y${y} opening cash balance`), sales_inflows: n(`Cashflow y${y} sales inflows`),
      equipment_payments: n(`Cashflow y${y} equipment payments`), closing_cash_balance: n(`Cashflow y${y} closing cash balance`),
    };
    if (hasAny({ ...row, year: null, month: null })) cash.push(row);
  }
  await replaceRows(client, 'cluster_cashflow', cid, cash);

  const bs = [];
  for (const y of [1, 2, 3]) {
    const row = {
      year: y,
      asset_cash: n(`Balance y${y} asset cash`), asset_receivables: n(`Balance y${y} asset receivables`),
      asset_inventory: n(`Balance y${y} asset inventory`), asset_fixed_assets_net: n(`Balance y${y} asset fixed assets net`),
      liab_payables: n(`Balance y${y} liab payables`), liab_loans: n(`Balance y${y} liab loans`),
      equity_members_contrib: n(`Balance y${y} equity members contributions`), equity_retained_earnings: n(`Balance y${y} equity retained earnings`),
    };
    if (hasAny({ ...row, year: null })) bs.push(row);
  }
  await replaceRows(client, 'cluster_balancesheet', cid, bs);

  // risks: "Risk <key> likelihood|impact|mitigation|phase"
  const riskKeys = new Map();
  for (const label of f.keys()) {
    const m = label.match(/^Risk (.+) (likelihood|impact|mitigation|phase)$/);
    if (m) { if (!riskKeys.has(m[1])) riskKeys.set(m[1], {}); riskKeys.get(m[1])[m[2]] = f.get(label) || null; }
  }
  const risks = [];
  for (const [key, r] of riskKeys) {
    if (!r.likelihood && !r.impact && !r.mitigation) continue;
    const named = t(`Risk ${key}`);
    risks.push({
      risk_category: trunc(named ? `${key}: ${named}` : key, 60),
      likelihood: trunc(r.likelihood, 10), impact: trunc(r.impact, 10), phase: trunc(r.phase, 20), mitigation: r.mitigation,
    });
  }
  await replaceRows(client, 'cluster_risks', cid, risks);

  // 10. audit log of every changed scalar value
  const after = await snapshot(client, cid);
  let changes = 0;
  for (const tbl of SCALAR_TABLES) {
    for (const col of Object.keys(after[tbl])) {
      if (IGNORE.has(col)) continue;
      const o = show(before[tbl][col]);
      const nw = show(after[tbl][col]);
      if (o !== nw) {
        changes++;
        await client.query(
          'INSERT INTO drive_sync_log (cluster_id, application_number, table_name, field, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6)',
          [cid, cluster.application_number, tbl, col, o == null ? null : o.slice(0, 500), nw == null ? null : nw.slice(0, 500)],
        );
      }
    }
  }
  return { changes };
}
