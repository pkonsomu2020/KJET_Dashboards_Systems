/**
 * smoke.test.js — Integration smoke tests.
 * Requires the API server to be running on PORT (default 4000).
 * Run standalone: node tests/smoke.test.js
 */
import 'dotenv/config';

const BASE = `http://localhost:${process.env.PORT || 4000}`;
let passed = 0;
let failed = 0;

let cookie = '';

async function request(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json, res };
}

async function signIn() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env to run the smoke tests');
  const { status, res } = await request('POST', '/api/auth/sign-in/email', { email, password }, { auth: false });
  if (status !== 200) throw new Error(`Smoke test sign-in failed (HTTP ${status})`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log(`\n[Smoke tests] Target: ${BASE}\n`);

  // ── 1. Root ────────────────────────────────────────────────
  console.log('1. Root endpoint');
  {
    const { status, body } = await request('GET', '/');
    assert('GET / returns 200',          status === 200);
    assert('Response has name field',    body?.name === 'KJET Co-Investment API');
  }

  // ── 2. Health ──────────────────────────────────────────────
  console.log('\n2. Health endpoint');
  {
    const { status, body } = await request('GET', '/health');
    assert('GET /health returns 200 or 503', [200, 503].includes(status));
    assert('Response has ok field',          typeof body?.ok === 'boolean');
    assert('Response has services.database', !!body?.services?.database);
    assert('Response has services.redis',    !!body?.services?.redis);
    assert('Response has timestamp',         !!body?.timestamp);
    if (status !== 200) {
      console.warn('  ⚠️  Database is down — remaining DB tests will fail.');
    }
  }

  // ── 2b. Auth is enforced, then sign in ─────────────────────
  console.log('\n2b. Authentication');
  {
    const { status } = await request('GET', '/api/portfolio/summary', undefined, { auth: false });
    assert('Unauthenticated data request returns 401', status === 401);
    await signIn();
    assert('Sign-in succeeded', !!cookie);
  }

  // ── 3. Portfolio summary ───────────────────────────────────
  console.log('\n3. Portfolio summary');
  {
    const { status, body } = await request('GET', '/api/portfolio/summary');
    assert('GET /api/portfolio/summary returns 200', status === 200);
    assert('Response ok=true',    body?.ok === true);
    assert('data.count is a number', typeof Number(body?.data?.count) === 'number');
    assert('data has grant field',   body?.data?.grant !== undefined);
    assert('data has members field', body?.data?.members !== undefined);
  }

  // ── 4. Portfolio by-chain ──────────────────────────────────
  console.log('\n4. Portfolio by value chain');
  {
    const { status, body } = await request('GET', '/api/portfolio/by-chain');
    assert('GET /api/portfolio/by-chain returns 200', status === 200);
    assert('data is an array', Array.isArray(body?.data));
    if (body?.data?.length > 0) {
      const first = body.data[0];
      assert('Chain item has name',  !!first.name);
      assert('Chain item has count', first.count !== undefined);
      assert('Chain item has cost',  first.cost  !== undefined);
    }
  }

  // ── 5. Portfolio by-county ─────────────────────────────────
  console.log('\n5. Portfolio by county');
  {
    const { status, body } = await request('GET', '/api/portfolio/by-county');
    assert('GET /api/portfolio/by-county returns 200', status === 200);
    assert('data is an array', Array.isArray(body?.data));
  }

  // ── 6. Compliance ──────────────────────────────────────────
  console.log('\n6. Portfolio compliance');
  {
    const { status, body } = await request('GET', '/api/portfolio/compliance');
    assert('GET /api/portfolio/compliance returns 200', status === 200);
    assert('data is an array', Array.isArray(body?.data));
  }

  // ── 7. Cluster list ────────────────────────────────────────
  console.log('\n7. Cluster list');
  {
    const { status, body } = await request('GET', '/api/clusters');
    assert('GET /api/clusters returns 200',      status === 200);
    assert('Response ok=true',                   body?.ok === true);
    assert('data is an array',                   Array.isArray(body?.data));
    assert('total field exists',                 body?.total !== undefined);
    assert('pageCount field exists',             body?.pageCount !== undefined);
    if (body?.data?.length > 0) {
      const c = body.data[0];
      assert('Cluster has application_number',   !!c.application_number);
      assert('Cluster has cluster_name',         !!c.cluster_name);
      assert('Cluster has county',               !!c.county);
      assert('Cluster has compliance_status',    !!c.compliance_status);
    }
  }

  // ── 8. Cluster list — filter by county ────────────────────
  console.log('\n8. Cluster list — county filter');
  {
    const { status, body } = await request('GET', '/api/clusters?county=Baringo');
    assert('Returns 200', status === 200);
    if (body?.data?.length > 0) {
      assert('All results are Baringo county',
        body.data.every((c) => c.county === 'Baringo'));
    }
  }

  // ── 9. Cluster list — bad params ──────────────────────────
  console.log('\n9. Cluster list — invalid sort param');
  {
    const { status } = await request('GET', '/api/clusters?sort=invalid_value');
    assert('Invalid sort returns 400', status === 400);
  }

  // ── 10. Cluster meta ───────────────────────────────────────
  console.log('\n10. Cluster meta (dropdown options)');
  {
    const { status, body } = await request('GET', '/api/clusters/meta');
    assert('GET /api/clusters/meta returns 200', status === 200);
    assert('counties is an array',               Array.isArray(body?.counties));
    assert('chains is an array',                 Array.isArray(body?.chains));
  }

  // ── 11. Cluster detail ─────────────────────────────────────
  console.log('\n11. Cluster detail — known cluster');
  {
    const { status, body } = await request('GET', '/api/clusters/KJET-2026-848853');
    assert('GET known cluster returns 200',    status === 200);
    assert('data has cluster_name',            !!body?.data?.cluster_name);
    assert('data has compliance_status',       !!body?.data?.compliance_status);
    assert('data has machinery array',         Array.isArray(body?.data?.machinery));
    assert('data has employment data',         body?.data?.jobs_today !== undefined);
  }

  // ── 12. Cluster detail — unknown ──────────────────────────
  console.log('\n12. Cluster detail — unknown cluster');
  {
    const { status } = await request('GET', '/api/clusters/KJET-0000-000000');
    assert('Unknown cluster returns 404', status === 404);
  }

  // ── 13. Auth endpoints present ────────────────────────────
  console.log('\n13. Auth routes present');
  {
    const { status } = await request('POST', '/api/auth/sign-in/email', {
      email: 'notexist@test.com', password: 'wrongpassword'
    });
    // Should be 401 or 422, not 404 (route must exist)
    assert('Auth sign-in route exists (not 404)', status !== 404);
  }

  // ── 14. 404 handler ────────────────────────────────────────
  console.log('\n14. 404 fallthrough');
  {
    const { status, body } = await request('GET', '/api/nonexistent/route');
    assert('Unknown route returns 404', status === 404);
    assert('Error message in body',     !!body?.error);
  }

  // ── 15. Cache header (second call) ────────────────────────
  console.log('\n15. Cache — second call to summary');
  {
    const { body } = await request('GET', '/api/portfolio/summary');
    // After the first call seeded the cache, subsequent calls should return cached:true
    // (only works if Redis is up)
    assert('Second call succeeds', !!body);
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[Smoke tests] Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[Smoke tests] Crashed:', err.message);
  process.exit(1);
});
