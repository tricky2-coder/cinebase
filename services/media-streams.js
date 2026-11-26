// Direct HLS/MP4 stream extraction for Movies & TV Series via:
//   1. @movie-web/providers (P-Stream provider engine)
//   2. @consumet/extensions (FlixHQ, DramaCool, SFlix, Goku, HiMovies)
// Races both engines in parallel so Artplayer gets whichever working stream responds first.

const { makeProviders, makeStandardFetcher, targets } = require('@movie-web/providers');
const { MOVIES } = require('@consumet/extensions');

let mwProviders = null;
function getMwProviders() {
  if (!mwProviders) {
    mwProviders = makeProviders({
      fetcher: makeStandardFetcher(fetch),
      target: targets.ANY
    });
  }
  return mwProviders;
}

function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’`:!?.,()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapProxy(url, referer = '') {
  return `/api/anime/proxy?url=${encodeURIComponent(url)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`;
}

function mapCaptions(captions = [], referer = '') {
  return (Array.isArray(captions) ? captions : [])
    .filter(c => c && c.url)
    .map(c => ({
      url: wrapProxy(c.url, referer),
      lang: c.language || c.lang || c.label || 'English',
      default: /eng|^en\b/i.test(c.language || c.lang || c.label || '')
    }));
}

async function tryPStream({ title, year, tmdbId, isSeries, season, episode }) {
  const providers = getMwProviders();
  const media = isSeries
    ? {
        type: 'show',
        title,
        releaseYear: Number(year) || new Date().getFullYear(),
        tmdbId: String(tmdbId || ''),
        season: { number: Number(season) || 1, tmdbId: '' },
        episode: { number: Number(episode) || 1, tmdbId: '' }
      }
    : {
        type: 'movie',
        title,
        releaseYear: Number(year) || new Date().getFullYear(),
        tmdbId: String(tmdbId || '')
      };

  const out = await Promise.race([
    providers.runAll({ media }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('P-Stream timeout')), 8500))
  ]);

  if (!out || !out.stream) throw new Error('P-Stream: no stream found');
  const st = out.stream;
  const referer = st.headers?.Referer || st.headers?.referer || st.preferredHeaders?.Referer || '';
  const sources = [];

  if (st.type === 'hls' && st.playlist) {
    sources.push({
      url: wrapProxy(st.playlist, referer),
      directUrl: st.playlist,
      hasReferer: Boolean(referer),
      isM3U8: true,
      quality: 'Auto'
    });
  } else if (st.type === 'file' && st.qualities) {
    for (const [q, info] of Object.entries(st.qualities)) {
      if (info && info.url) {
        sources.push({
          url: wrapProxy(info.url, referer),
          directUrl: info.url,
          hasReferer: Boolean(referer),
          isM3U8: String(info.url).includes('.m3u8'),
          quality: `${q}p`
        });
      }
    }
  }

  if (!sources.length) throw new Error('P-Stream: empty stream sources');
  return {
    engine: 'pstream',
    providerLabel: `P-Stream (${out.sourceId || 'auto'})`,
    sources,
    subtitles: mapCaptions(st.captions, referer)
  };
}

function pickConsumetMatch(results, title, year, isSeries) {
  if (!Array.isArray(results) || !results.length) return null;
  const target = normTitle(title);
  const scored = results.map(r => {
    const rt = normTitle(r.title);
    let score = 0;
    if (rt === target) score += 100;
    else if (rt.includes(target) || target.includes(rt)) score += 60;
    if (year && String(r.releaseDate || '').includes(String(year))) score += 25;
    if (r.type) {
      const wantTv = isSeries;
      const gotTv = /tv|series|drama/i.test(String(r.type));
      if (wantTv === gotTv) score += 15;
    }
    return { r, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 50 ? scored[0].r : scored[0]?.r || null;
}

async function tryConsumetProvider(ProviderClass, name, { title, year, isSeries, season, episode }) {
  const inst = new ProviderClass();
  const search = await Promise.race([
    inst.search(title),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} search timeout`)), 5500))
  ]);
  const match = pickConsumetMatch(search?.results, title, year, isSeries);
  if (!match || !match.id) throw new Error(`${name}: no match`);

  const info = await Promise.race([
    inst.fetchMediaInfo(match.id),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} info timeout`)), 5500))
  ]);
  const eps = Array.isArray(info?.episodes) ? info.episodes : [];
  if (!eps.length) throw new Error(`${name}: no episodes`);

  let epObj = eps[0];
  if (isSeries) {
    const sNum = Number(season) || 1;
    const eNum = Number(episode) || 1;
    epObj = eps.find(e => (Number(e.season) || 1) === sNum && Number(e.number) === eNum)
      || eps.find(e => Number(e.number) === eNum)
      || null;
    if (!epObj) throw new Error(`${name}: S${sNum}E${eNum} not found`);
  }

  const data = await Promise.race([
    inst.fetchEpisodeSources(epObj.id, info.id || match.id),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} sources timeout`)), 6500))
  ]);

  const rawSources = Array.isArray(data?.sources) ? data.sources : [];
  const referer = data?.headers?.Referer || data?.headers?.referer || '';
  const sources = rawSources
    .filter(s => s && s.url)
    .map(s => ({
      url: wrapProxy(s.url, referer),
      directUrl: s.url,
      hasReferer: Boolean(referer),
      isM3U8: Boolean(s.isM3U8 || String(s.url).includes('.m3u8')),
      quality: s.quality || 'Auto'
    }));

  if (!sources.length) throw new Error(`${name}: no playable sources`);

  return {
    engine: 'consumet',
    providerLabel: `Consumet (${name})`,
    sources,
    subtitles: mapCaptions(data?.subtitles, referer)
  };
}

async function getMediaStreams({ title, year = '', tmdbId = '', type = 'Movie', season = 1, episode = 1 }) {
  if (!title) throw new Error('Title is required');
  const isSeries = type === 'Series' || type === 'tv';
  const ctx = { title, year, tmdbId, isSeries, season, episode };

  const tasks = [
    tryPStream(ctx),
    tryConsumetProvider(MOVIES.FlixHQ, 'FlixHQ', ctx),
    tryConsumetProvider(MOVIES.SFlix, 'SFlix', ctx),
    tryConsumetProvider(MOVIES.HiMovies, 'HiMovies', ctx)
  ];
  if (isSeries) {
    tasks.push(tryConsumetProvider(MOVIES.DramaCool, 'DramaCool', ctx));
  }

  try {
    return await Promise.any(tasks);
  } catch (aggErr) {
    const errors = Array.isArray(aggErr?.errors) ? aggErr.errors.map(e => e.message) : [aggErr?.message || 'All direct stream extractors failed'];
    throw new Error(errors.join(' | '));
  }
}

module.exports = { getMediaStreams };
