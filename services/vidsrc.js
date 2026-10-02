// VidSrc embed player. Mirrors change often, so the list is configurable:
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc   (first one is the default)
// VIDSRC_SANDBOX=1 sandboxes the iframe (blocks popups/redirects) — off by default
// because some mirrors refuse to play inside a sandbox.
const DEFAULT_DOMAINS = ['vidsrc.pm', 'vidsrc.cc'];

// URL shape per mirror. {id} = IMDb or TMDB id, {s} = season, {e} = episode.
const FORMATS = {
  // From vidsrc.pm's own router: /embed/movie/:id and /embed/tv/:id/:season/:episode
  'vidsrc.pm': { movie: '/embed/movie/{id}', tv: '/embed/tv/{id}/{s}/{e}' },
  'vidsrc.cc': { movie: '/embed/movie/{id}', tv: '/v2/embed/tv/{id}/{s}/{e}' },
  // vidsrc.xyz / vidsrc.in / vidsrc.net family
  '*': { movie: '/embed/movie/{id}', tv: '/embed/tv/{id}/{s}-{e}' }
};

function domains() {
  const list = (process.env.VIDSRC_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  return list.length ? list : DEFAULT_DOMAINS;
}

const sandboxed = () => process.env.VIDSRC_SANDBOX === '1';

function embedUrl(domain, id, isSeries, season = 1, episode = 1) {
  const f = (FORMATS[domain] || FORMATS['*'])[isSeries ? 'tv' : 'movie'];
  return `https://${domain}` + f.replace('{id}', id).replace('{s}', season).replace('{e}', episode);
}

// Everything the detail page needs to build and switch the player, or null if the title has no id.
// `seasons` ([{ n, name, episodes }]) and `tvId` come from TMDB when available.
function player(item, { seasons = null, tvId = null } = {}) {
  const id = item.imdb_id || item.tmdb_id;
  if (!id) return null;
  const isSeries = item.type === 'Series';
  const list = domains();
  const fallbackSeasons = Array.from({ length: item.seasons || 1 }, (_, i) => ({ n: i + 1, name: `Season ${i + 1}`, episodes: null }));
  return {
    src: embedUrl(list[0], id, isSeries),
    sandbox: sandboxed(),
    isSeries,
    domains: list,
    seasons: isSeries ? (seasons?.length ? seasons : fallbackSeasons) : null,
    // Client-side config for switching mirror / episode
    cfg: {
      id: String(id),
      isSeries,
      tvId,
      key: String(tvId || id),
      formats: Object.fromEntries(list.map(d => [d, (FORMATS[d] || FORMATS['*'])[isSeries ? 'tv' : 'movie']])),
      seasons: isSeries ? (seasons?.length ? seasons : fallbackSeasons) : null
    }
  };
}

module.exports = { domains, player, embedUrl };
