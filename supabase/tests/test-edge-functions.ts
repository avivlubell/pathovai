/**
 * Pathova Edge Function Test Suite
 * 
 * Run with: npx tsx supabase/tests/test-edge-functions.ts
 * 
 * Requires env vars:
 *   SUPABASE_URL=https://urmgbmfvjuozvhigflqt.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
 *   SUPABASE_ANON_KEY=<your-anon-key>
 */

const BASE = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1`
  : 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

// --- Test infrastructure ---
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function callFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: ANON_KEY || SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${testName}`);
    passed++;
  } else {
    console.log(`  FAIL  ${testName}${detail ? ' -- ' + detail : ''}`);
    failed++;
    failures.push(testName);
  }
}

// ============================================================
// TEST SUITES
// ============================================================

async function testSearchProspects() {
  console.log('\n--- search-prospects ---');

  // 1. Known contact by name
  const r1 = await callFunction('search-prospects', { query: 'nick lubbers' });
  assert(r1.status === 200, 'contact search returns 200');
  assert(r1.data.total > 0, 'contact search: total > 0 for known contact');
  assert(
    Array.isArray(r1.data.contacts) && r1.data.contacts.length > 0,
    'contact search: contacts array has results for nick lubbers'
  );
  assert(
    r1.data.contacts?.some((c: any) => c.full_name?.toLowerCase().includes('nick lubbers')),
    'contact search: found Nick Lubbers by name'
  );

  // 2. Known account by name
  const r2 = await callFunction('search-prospects', { query: 'Echo IQ' });
  assert(r2.status === 200, 'account search returns 200');
  assert(
    Array.isArray(r2.data.prospects) && r2.data.prospects.length > 0,
    'account search: prospects array has results for Echo IQ'
  );

  // 3. Known account with tier
  const r3 = await callFunction('search-prospects', { query: 'GrayMatters' });
  assert(r3.status === 200, 'GrayMatters search returns 200');
  assert(r3.data.total > 0, 'GrayMatters search: total > 0');

  // 4. Partial match
  const r4 = await callFunction('search-prospects', { query: 'nick' });
  assert(r4.status === 200, 'partial search returns 200');
  assert(r4.data.total > 0, 'partial search: total > 0 for "nick"');

  // 5. No results
  const r5 = await callFunction('search-prospects', { query: 'xyznonexistent99' });
  assert(r5.status === 200, 'no-match search returns 200 (not error)');
  assert(r5.data.total === 0, 'no-match search: total is 0');
  assert(Array.isArray(r5.data.prospects), 'no-match search: prospects is array');
  assert(Array.isArray(r5.data.contacts), 'no-match search: contacts is array');

  // 6. Empty query (should return default results)
  const r6 = await callFunction('search-prospects', { query: '' });
  assert(r6.status === 200, 'empty query returns 200');
  assert(r6.data.total > 0, 'empty query: returns some results');

  // 7. Response shape
  assert(r1.data.summary !== undefined, 'response includes summary object');
  assert(r1.data.contacts_total !== undefined, 'response includes contacts_total');
}

async function testGetProspectDetail() {
  console.log('\n--- get-prospect-detail ---');

  // By company name
  const r1 = await callFunction('get-prospect-detail', { company_name: 'Echo IQ' });
  assert(r1.status === 200, 'get by company_name returns 200');
  assert(
    r1.data && !r1.data.error,
    'get by company_name: no error',
    r1.data?.error
  );

  // By non-existent name
  const r2 = await callFunction('get-prospect-detail', { company_name: 'xyznonexistent99' });
  assert(r2.status === 200, 'non-existent company returns 200 (not 500)');
}

async function testSearchReferences() {
  console.log('\n--- search-references ---');

  // By type
  const r1 = await callFunction('search-references', { type: 'methodology' });
  assert(r1.status === 200, 'methodology search returns 200');
  assert(
    Array.isArray(r1.data) ? r1.data.length > 0 : r1.data && !r1.data.error,
    'methodology search: has results'
  );

  // By type: proof_asset
  const r2 = await callFunction('search-references', { type: 'proof_asset' });
  assert(r2.status === 200, 'proof_asset search returns 200');

  // With query
  const r3 = await callFunction('search-references', { type: 'methodology', query: 'ICP' });
  assert(r3.status === 200, 'methodology + query search returns 200');
}

async function testQueryDeals() {
  console.log('\n--- query-deals ---');

  const r1 = await callFunction('query-deals', {});
  assert(r1.status === 200, 'query-deals empty filter returns 200');
  assert(
    r1.data && !r1.data.error,
    'query-deals: no error in response',
    r1.data?.error
  );
}

async function testStoreLearning() {
  console.log('\n--- store-learning ---');

  const r1 = await callFunction('store-learning', {
    feedback: 'TEST: This is an automated test learning -- safe to delete',
    agent_source: '*',
  });
  assert(r1.status === 200, 'store-learning returns 200');
  assert(
    r1.data && !r1.data.error,
    'store-learning: no error',
    r1.data?.error
  );
}

async function testLogAgentRun() {
  console.log('\n--- log-agent-run ---');

  const r1 = await callFunction('log-agent-run', {
    action_type: 'test_run',
    decision_mode: 'Quick Lookup',
    context_score: 1,
    summary: 'Automated test -- safe to delete',
  });
  assert(r1.status === 200, 'log-agent-run returns 200');
  assert(
    r1.data && !r1.data.error,
    'log-agent-run: no error',
    r1.data?.error
  );
}

// ============================================================
// RUNNER
// ============================================================

async function main() {
  console.log('=== Pathova Edge Function Tests ===');
  console.log(`Target: ${BASE}`);
  console.log('');

  await testSearchProspects();
  await testGetProspectDetail();
  await testSearchReferences();
  await testQueryDeals();
  await testStoreLearning();
  await testLogAgentRun();

  console.log('\n=== Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
