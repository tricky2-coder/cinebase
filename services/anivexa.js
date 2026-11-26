// Anime streaming aggregator: Consumet (Server 1), P-Stream (Server 2), + Anivexa-API (Servers 3-12)
const mediaStreams = require('./media-streams');

const DEFAULT_PROVIDERS = [
  { id: 'consumet', label: 'Server 1', local: true },
  { id: 'pstream', label: 'Server 2', local: true },
  { id: 'anizone', label: 'Server 3' },
  { id: 'anikoto', label: 'Server 4' },
  { id: 'anipm', label: 'Server 5' },
  { id: 'animegg', label: 'Server 6' },
  { id: 'animedunya', label: 'Server 7' },
  { id: 'aniwaves', label: 'Server 8' },
  { id: 'pahenime', label: 'Server 9' },
  { id: 'animenosub', label: 'Server 10' },
  { id: 'anihq', label: 'Server 11' },
  { id: 'reanime', label: 'Server 12' }
];

const PUBLIC_PROVIDERS = DEFAULT_PROVIDERS.map(({ id, label }) => ({ id, label }));

let lastWakeAt = 0;

function baseUrl() {
  return (process.env.ANIVEXA_URL || '').trim().replace(/\/+$/, '');
}

function enabled() {
  return Boolean(baseUrl());
}

function wakeUp() {
  const base = baseUrl();
  if (!base) return;
  const now = Date.now();
  if (now - lastWakeAt < 5 * 60 * 1000) return;
  lastWakeAt = now;
  fetch(base, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

async function fetchProviderWatch(base, prov, anilistId, cleanAudio, ep) {
  const url = `${base}/watch/${encodeURIComponent(prov.id)}/${encodeURIComponent(anilistId)}/${cleanAudio}/${encodeURIComponent(prov.id)}-${encodeURIComponent(ep)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8500)
  });

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) {
    const upstreamMsg = data?.error ? `: ${data.error}` : '';
    throw new Error(`${prov.label} HTTP ${res.status}${upstreamMsg}`);
  }
  if (!data) {
    throw new Error(`${prov.label} returned non-JSON response`);
  }

  const rawList = Array.isArray(data.streams) ? data.streams
    : Array.isArray(data.sources) ? data.sources
    : Array.isArray(data.data?.sources) ? data.data.sources
    : (data.url ? [{ url: data.url, isM3U8: String(data.url).includes('.m3u8'), quality: data.quality || 'auto' }] : []);

  const playable = rawList.filter(s =>
    s && s.url &&
    s.type !== 'embed' &&
    s.type !== 'dash' &&
    !String(s.url).toLowerCase().includes('.mpd')
  );
  if (!playable.length) {
    throw new Error(`${prov.label} returned no HLS/MP4 streams`);
  }

  const topHeaders = data.headers || data.data?.headers || {};
  const collectedSubs = [];

  const sources = playable.map(s => {
    const referer = s.referer || topHeaders.Referer || topHeaders.referer || '';
    const playlistKey = s.playlist_key || s.key || data.playlist_key || data.key || '';
    const isM3U8 = Boolean(s.type === 'hls' || s.isM3U8 || String(s.url).includes('.m3u8') || playlistKey);
    const proxiedUrl = `/api/anime/proxy?url=${encodeURIComponent(s.url)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}${playlistKey ? `&key=${encodeURIComponent(playlistKey)}` : ''}`;

    if (Array.isArray(s.subtitles)) {
      for (const t of s.subtitles) {
        if (t && t.url) {
          collectedSubs.push({
            url: `/api/anime/proxy?url=${encodeURIComponent(t.url)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`,
            lang: t.label || t.lang || t.srclang || 'English',
            default: Boolean(t.default || /eng/i.test(t.label || t.lang || t.srclang || ''))
          });
        }
      }
    }

    return {
      url: proxiedUrl,
      directUrl: s.url,
      hasReferer: Boolean(referer || playlistKey),
      isM3U8,
      quality: s.quality || s.server || 'Auto'
    };
  });

  const topSubs = Array.isArray(data.subtitles) ? data.subtitles
    : Array.isArray(data.tracks) ? data.tracks
    : Array.isArray(data.data?.subtitles) ? data.data.subtitles
    : [];
  const fallbackRef = topHeaders.Referer || topHeaders.referer || '';
  for (const t of topSubs) {
    if (t && t.url) {
      collectedSubs.push({
        url: `/api/anime/proxy?url=${encodeURIComponent(t.url)}${fallbackRef ? `&referer=${encodeURIComponent(fallbackRef)}` : ''}`,
        lang: t.label || t.lang || t.srclang || 'English',
        default: Boolean(t.default || /eng/i.test(t.label || t.lang || t.srclang || ''))
      });
    }
  }

  return {
    provider: prov.id,
    providerLabel: prov.label,
    providers: PUBLIC_PROVIDERS,
    audio: cleanAudio,
    sources,
    subtitles: collectedSubs
  };
}

async function fetchLocalWatch(provId, meta, ep, cleanAudio) {
  const res = await mediaStreams.getAnimeStreams({
    title: meta?.title || '',
    year: meta?.year || '',
    tmdbId: meta?.tmdbId || '',
    episode: Number(ep) || 1,
    audio: cleanAudio,
    engine: provId
  });
  const prov = DEFAULT_PROVIDERS.find(p => p.id === provId) || { id: provId, label: provId };
  return {
    provider: prov.id,
    providerLabel: prov.label,
    providers: PUBLIC_PROVIDERS,
    audio: cleanAudio,
    sources: res.sources,
    subtitles: res.subtitles
  };
}

/**
 * Fetch stream sources for an anime episode.
 * Server 1 = Consumet, Server 2 = P-Stream, Servers 3-12 = Anivexa-API.
 */
async function getWatchSources(anilistId, ep, audio = 'sub', preferredProvider = null, meta = {}) {
  const base = baseUrl();
  const cleanAudio = audio === 'dub' ? 'dub' : 'sub';

  if (preferredProvider === 'consumet' || preferredProvider === 'pstream') {
    return fetchLocalWatch(preferredProvider, meta, ep, cleanAudio);
  }

  if (preferredProvider && preferredProvider !== 'auto' && preferredProvider !== 'vidy') {
    const picked = DEFAULT_PROVIDERS.find(p => p.id === preferredProvider);
    if (picked) {
      if (!base) throw new Error('Anime streaming server is not configured (set ANIVEXA_URL).');
      return fetchProviderWatch(base, picked, anilistId, cleanAudio, ep);
    }
  }

  // Auto mode: race Consumet + P-Stream + top Anivexa servers (if ANIVEXA_URL configured)
  const tasks = [
    fetchLocalWatch('consumet', meta, ep, cleanAudio),
    fetchLocalWatch('pstream', meta, ep, cleanAudio)
  ];
  if (base) {
    const anivexaTop = DEFAULT_PROVIDERS.filter(p => !p.local).slice(0, 4);
    tasks.push(...anivexaTop.map(p => fetchProviderWatch(base, p, anilistId, cleanAudio, ep)));
  }

  try {
    return await Promise.any(tasks);
  } catch (aggErr) {
    const errors = Array.isArray(aggErr?.errors) ? aggErr.errors.map(e => e.message) : [aggErr?.message || 'All servers failed'];
    console.error('All anime providers failed:', errors);
    throw new Error('This server is unavailable right now.');
  }
}

module.exports = {
  DEFAULT_PROVIDERS: PUBLIC_PROVIDERS,
  enabled,
  wakeUp,
  getWatchSources
};
