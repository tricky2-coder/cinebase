// Plex Media Server integration.
// Set PLEX_URL (e.g. http://192.168.1.50:32400) and PLEX_TOKEN on the CineBase server.
// The token never reaches the browser: artwork is proxied through /media/plex-art.

const cfg = () => ({
  url: (process.env.PLEX_URL || '').trim().replace(/\/+$/, ''),
  token: (process.env.PLEX_TOKEN || '').trim()
});
const enabled = () => !!(cfg().url && cfg().token);

let machineId = null; // cached server identifier, used to build "Play on Plex" links

async function call(endpoint, params = {}) {
  const { url, token } = cfg();
  if (!url || !token) throw new Error('PLEX_URL and PLEX_TOKEN are not set');
  const u = new URL(url + endpoint);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': token,
      'X-Plex-Product': 'CineBase',
      'X-Plex-Client-Identifier': 'cinebase-server'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (res.status === 401) throw new Error('Plex rejected the token (401). Check PLEX_TOKEN.');
  if (!res.ok) throw new Error(`Plex ${res.status}: ${res.statusText}`);
  return res.json();
}

async function identity() {
  const d = await call('/identity');
  machineId = d.MediaContainer.machineIdentifier;
  return { machineId, version: d.MediaContainer.version };
}

async function status() {
  if (!enabled()) return { configured: false };
  try {
    const id = await identity();
    const root = await call('/');
    return { configured: true, online: true, name: root.MediaContainer.friendlyName, ...id };
  } catch (e) {
    return { configured: true, online: false, error: e.cause?.code || e.message };
  }
}

async function libraries() {
  const d = await call('/library/sections');
  return (d.MediaContainer.Directory || [])
    .filter(s => s.type === 'movie' || s.type === 'show')
    .map(s => ({ key: s.key, title: s.title, type: s.type }));
}

const tags = arr => (arr || []).map(t => t.tag);

// Map a Plex item to CineBase title fields
function toTitle(m) {
  const isShow = m.type === 'show';
  const art = p => (p ? `/media/plex-art?path=${encodeURIComponent(p)}` : null);
  return {
    plex_rating_key: String(m.ratingKey),
    title: m.title,
    type: isShow ? 'Series' : 'Movie',
    genre: tags(m.Genre)[0] || 'Drama',
    language: 'Unknown',
    release_year: m.year || new Date().getFullYear(),
    director: tags(m.Director).join(', ') || null,
    cast_members: tags(m.Role).slice(0, 6).join(', ') || null,
    seasons: isShow ? (m.childCount || null) : null,
    duration_min: m.duration ? Math.round(m.duration / 60000) : null,
    rating: m.audienceRating ?? m.rating ?? null,
    platform: 'Plex',
    status: 'Released',
    synopsis: m.summary || null,
    poster_url: art(m.thumb),
    backdrop_url: art(m.art)
  };
}

async function libraryItems(sectionKey) {
  const d = await call(`/library/sections/${encodeURIComponent(sectionKey)}/all`, { includeGuids: 1 });
  return (d.MediaContainer.Metadata || []).map(toTitle);
}

// Deep link that opens the item in Plex Web (works on any device signed into the same Plex account)
async function watchUrl(ratingKey) {
  if (!machineId) await identity();
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${key}`;
}

// Stream artwork from Plex without exposing the token
async function art(path) {
  if (!/^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/.test(path)) throw new Error('Invalid artwork path');
  const { url, token } = cfg();
  const u = new URL(`${url}/photo/:/transcode`);
  u.searchParams.set('url', path);
  u.searchParams.set('width', path.includes('/art/') ? '1280' : '400');
  u.searchParams.set('height', path.includes('/art/') ? '720' : '600');
  u.searchParams.set('X-Plex-Token', token);
  return fetch(u, { signal: AbortSignal.timeout(15000) });
}

module.exports = { enabled, status, libraries, libraryItems, watchUrl, art };
