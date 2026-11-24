// Production Route & API Verification Suite

async function verify() {
  const base = 'http://localhost:3000';
  let passed = 0, failed = 0;

  async function check(name, fn) {
    try {
      await fn();
      console.log('PASS:', name);
      passed++;
    } catch (e) {
      console.error('FAIL:', name, e.message);
      failed++;
    }
  }

  // 1. Unauthenticated checks
  await check('GET /login returns 200', async () => {
    const r = await fetch(base + '/login');
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  // 2. Authentication
  let cookie = '';
  await check('POST /login authenticates admin', async () => {
    const r = await fetch(base + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=admin&password=admin123',
      redirect: 'manual'
    });
    cookie = r.headers.get('set-cookie');
    if (!cookie) throw new Error('No cookie set');
  });

  const authHeaders = { 'Cookie': cookie, 'Content-Type': 'application/json' };

  // 3. Core Pages
  await check('GET / returns 200', async () => {
    const r = await fetch(base + '/', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /watchlist returns 200', async () => {
    const r = await fetch(base + '/watchlist', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /history returns 200', async () => {
    const r = await fetch(base + '/history', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /browse returns 200', async () => {
    const r = await fetch(base + '/browse', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /t/1 (movie detail) returns 200 with no sandbox', async () => {
    const r = await fetch(base + '/t/1', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
    const html = await r.text();
    if (!html.includes('id="player"')) throw new Error('Player element missing');
    if (!html.includes('ep-fs-btn')) throw new Error('ep-fs-btn missing');
    if (html.includes('sandbox=')) throw new Error('Unexpected sandbox attribute found');
  });

  await check('GET /t/2 (series detail) returns 200 with episode controls', async () => {
    const r = await fetch(base + '/t/2', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
    const html = await r.text();
    if (!html.includes('id="player"')) throw new Error('Player element missing');
    if (!html.includes('p-quick-nav')) throw new Error('Quick nav missing');
  });

  // 4. API Endpoints
  let profiles = [];
  await check('GET /api/profiles returns list', async () => {
    const r = await fetch(base + '/api/profiles', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
    const data = await r.json();
    if (!Array.isArray(data.profiles) || !data.profiles.length) throw new Error('No profiles array');
    profiles = data.profiles;
  });

  await check('POST /api/history logs progress', async () => {
    const r = await fetch(base + '/api/history', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        media_type: 'movie',
        media_id: '1',
        title: 'Inception',
        poster_url: '',
        href: '/t/1',
        progress_seconds: 120,
        duration_seconds: 8880
      })
    });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('POST /api/watchlist toggles item', async () => {
    const r = await fetch(base + '/api/watchlist', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        media_type: 'movie',
        media_id: '1',
        title: 'Inception',
        poster_url: '',
        release_year: '2010',
        rating: 8.8,
        href: '/t/1'
      })
    });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  // 5. Admin Pages
  await check('GET /dashboard returns 200', async () => {
    const r = await fetch(base + '/dashboard', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /users returns 200', async () => {
    const r = await fetch(base + '/users', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /titles returns 200', async () => {
    const r = await fetch(base + '/titles', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  await check('GET /plex returns 200', async () => {
    const r = await fetch(base + '/plex', { headers: authHeaders });
    if (r.status !== 200) throw new Error('Status ' + r.status);
  });

  // 6. 404 handler
  await check('GET /unknown-route returns 404', async () => {
    const r = await fetch(base + '/unknown-route', { headers: authHeaders });
    if (r.status !== 404) throw new Error('Status was not 404: ' + r.status);
  });

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log('Passed:', passed, 'Failed:', failed);
  if (failed > 0) process.exit(1);
}

verify().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
