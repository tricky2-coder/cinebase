// Anivexa-API integration for anime streaming (server-side only; hidden from end users)
const DEFAULT_PROVIDERS = [
  { id: 'anizone', label: 'Server 1' },
  { id: 'anihq', label: 'Server 2' },
  { id: 'aniwaves', label: 'Server 3' },
  { id: 'reanime', label: 'Server 4' }
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

/**
 * Fetch stream sources for an anime episode from Anivexa-API.
 * Tries preferredProvider first, then falls back through DEFAULT_PROVIDERS.
 */
async function getWatchSources(anilistId, ep, audio = 'sub', preferredProvider = null) {
  const base = baseUrl();
  if (!base) {
    throw new Error('ANIVEXA_URL is not configured');
  }

  const cleanAudio = audio === 'dub' ? 'dub' : 'sub';
  const order = preferredProvider
    ? [
        ...DEFAULT_PROVIDERS.filter(p => p.id === preferredProvider),
        ...DEFAULT_PROVIDERS.filter(p => p.id !== preferredProvider)
      ]
    : DEFAULT_PROVIDERS;

  let lastErr = null;
  for (const prov of order) {
    try {
      const url = `${base}/watch/${encodeURIComponent(prov.id)}/${encodeURIComponent(anilistId)}/${cleanAudio}/${encodeURIComponent(prov.id)}-${encodeURIComponent(ep)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(25000) // generous timeout in case Render is waking from cold start
      });
      if (!res.ok) {
        lastErr = new Error(`${prov.label} returned HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();

      // Anivexa providers return either `streams` ([{ url, type, server, referer, subtitles }]) or `sources`
      const rawList = Array.isArray(data.streams) ? data.streams
        : Array.isArray(data.sources) ? data.sources
        : Array.isArray(data.data?.sources) ? data.data.sources
        : (data.url ? [{ url: data.url, isM3U8: String(data.url).includes('.m3u8'), quality: data.quality || 'auto' }] : []);

      // Filter to directly playable HLS/MP4/DASH streams (skip raw iframe-only entries if HLS exists)
      const playable = rawList.filter(s => s && s.url && s.type !== 'embed');
      if (!playable.length) {
        lastErr = new Error(`${prov.label} returned no playable streams`);
        continue;
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
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No anime streams available right now');
}

module.exports = {
  DEFAULT_PROVIDERS,
  enabled,
  wakeUp,
  getWatchSources
};
