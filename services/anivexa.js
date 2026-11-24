// Anivexa-API integration for anime streaming (server-side only; hidden from end users)
const DEFAULT_PROVIDERS = [
  { id: 'anizone', label: 'Server 1' },
  { id: 'anikoto', label: 'Server 2' },
  { id: 'anipm', label: 'Server 3' },
  { id: 'anihq', label: 'Server 4' },
  { id: 'aniwaves', label: 'Server 5' },
  { id: 'pahenime', label: 'Server 6' },
  { id: 'animedunya', label: 'Server 7' },
  { id: 'animegg', label: 'Server 8' },
  { id: 'animenosub', label: 'Server 9' },
  { id: 'reanime', label: 'Server 10' }
];

let lastWakeAt = 0;

function baseUrl() {
  return (process.env.ANIVEXA_URL || '').trim().replace(/\/+$/, '');
}

function enabled() {
  return Boolean(baseUrl());
}

/**
 * Fire-and-forget ping to wake a sleeping Render instance in the background
 * when a user opens Home or Anime Discover. Throttled to once every 5 minutes.
 */
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
    signal: AbortSignal.timeout(8500) // stays safely inside Vercel's 10s serverless limit
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

  // Anivexa providers return either `streams` ([{ url, type, server, referer, subtitles }]) or `sources`
  const rawList = Array.isArray(data.streams) ? data.streams
    : Array.isArray(data.sources) ? data.sources
    : Array.isArray(data.data?.sources) ? data.data.sources
    : (data.url ? [{ url: data.url, isM3U8: String(data.url).includes('.m3u8'), quality: data.quality || 'auto' }] : []);

  // Filter to Artplayer-compatible HLS/MP4 streams (exclude iframe embeds and DASH .mpd streams)
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
    const isM3U8 = Boolean(s.type === 'hls' || s.isM3U8 || String(s.url).includes('.m3u8'));
    const proxiedUrl = `/api/anime/proxy?url=${encodeURIComponent(s.url)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`;

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
      hasReferer: Boolean(referer),
      isM3U8,
      quality: s.quality || 'Auto'
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
    providers: DEFAULT_PROVIDERS,
    audio: cleanAudio,
    sources,
    subtitles: collectedSubs
  };
}

/**
 * Fetch stream sources for an anime episode from Anivexa-API.
 * Uses parallel race on Auto mode for fast loading within serverless timeouts.
 */
async function getWatchSources(anilistId, ep, audio = 'sub', preferredProvider = null) {
  const base = baseUrl();
  if (!base) {
    throw new Error('ANIVEXA_URL is not configured');
  }

  const cleanAudio = audio === 'dub' ? 'dub' : 'sub';

  if (preferredProvider && preferredProvider !== 'auto' && preferredProvider !== 'vidy') {
    const picked = DEFAULT_PROVIDERS.find(p => p.id === preferredProvider);
    if (picked) {
      return await fetchProviderWatch(base, picked, anilistId, cleanAudio, ep);
    }
  }

  try {
    return await Promise.any(DEFAULT_PROVIDERS.map(p => fetchProviderWatch(base, p, anilistId, cleanAudio, ep)));
  } catch (aggErr) {
    const errors = Array.isArray(aggErr?.errors) ? aggErr.errors.map(e => e.message) : [aggErr?.message || 'All servers failed'];
    console.error('All Anivexa providers failed:', errors);
    throw new Error(errors.join(' | '));
  }
}

module.exports = {
  DEFAULT_PROVIDERS,
  enabled,
  wakeUp,
  getWatchSources
};
