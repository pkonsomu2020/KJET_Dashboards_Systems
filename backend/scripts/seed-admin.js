/**
 * seed-admin.js — Creates the initial admin user via Better Auth API.
 *
 * Run AFTER the server is running:
 *   node scripts/seed-admin.js
 *
 * Creates these credentials:
 *   Email:    admin@kjet.go.ke
 *   Password: KJET@Cohort1#2026
 *
 * You can add more users by changing the USERS array below.
 */
import 'dotenv/config';

const BASE = process.env.BETTER_AUTH_URL || 'http://localhost:4000';

const USERS = [
  {
    name:     'KJET Administrator',
    email:    'admin@kjet.go.ke',
    password: 'KJET@Cohort1#2026',
    role:     'Admin — full portfolio access',
  },
  {
    name:     'MSEA Project Team',
    email:    'pit@kjet.go.ke',
    password: 'MSEA@PIT#2026',
    role:     'Project Implementation Team',
  },
  {
    name:     'World Bank Task Team',
    email:    'worldbank@kjet.go.ke',
    password: 'WB@KJET#Review2026',
    role:     'World Bank — read-only reviewer',
  },
];

async function createUser(user) {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: user.name, email: user.email, password: user.password }),
  });

  const body = await res.json().catch(() => ({}));

  if (res.ok && body.user) {
    console.log(`  ✅  Created: ${user.email}  (${user.role})`);
    return true;
  }

  // Already exists
  if (res.status === 422 || (body.code && body.code.includes('EXIST'))) {
    console.log(`  ℹ️   Exists:  ${user.email}  (skipped)`);
    return true;
  }

  // 200 with token also means success (Better Auth returns 200 on sign-up)
  if (res.ok && body.token) {
    console.log(`  ✅  Created: ${user.email}  (${user.role})`);
    return true;
  }

  console.error(`  ❌  Failed:  ${user.email} — ${JSON.stringify(body)}`);
  return false;
}

async function main() {
  console.log(`\n[seed-admin] Target: ${BASE}\n`);

  // Verify server is reachable
  try {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log('[seed-admin] Server is online\n');
  } catch {
    console.error('[seed-admin] ❌  Cannot reach the server. Make sure npm run dev is running first.\n');
    process.exit(1);
  }

  let ok = 0;
  for (const user of USERS) {
    const success = await createUser(user);
    if (success) ok++;
  }

  console.log(`\n[seed-admin] Done — ${ok}/${USERS.length} users ready.\n`);
  console.log('─'.repeat(55));
  console.log(' CREDENTIALS');
  console.log('─'.repeat(55));
  for (const user of USERS) {
    console.log(`\n  Role:     ${user.role}`);
    console.log(`  Email:    ${user.email}`);
    console.log(`  Password: ${user.password}`);
  }
  console.log('\n' + '─'.repeat(55));
  console.log(' Change passwords after first login.\n');
}

main().catch(err => {
  console.error('[seed-admin] Fatal:', err.message);
  process.exit(1);
});
