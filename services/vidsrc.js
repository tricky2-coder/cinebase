// Embedded players: VidSrc mirrors plus Vidy. Viewers pick one from the "Player" menu.
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc   VidSrc mirrors (the first player in the menu is the default)
//   VIDY=0                               hide the Vidy player (shown by default)
//   VIDSRC_SANDBOX=1                     sandbox the iframe (blocks popups/redirects; some players
//                                        refuse to play inside a sandbox)
const DEFAULT_DOMAINS = ['vidsrc.pm', 'vidsrc.cc'];
const VIDY = 'www.vidy.st'; // vidy.st redirects here

// URL shape per player. {id} = IMDb or TMDB id (see `id`), {s} = season, {e} = episode.
const PLAYERS = {
  // From vidsrc.pm's own router: /embed/movie/:id and /embed/tv/:id/:season/:episode
  'vidsrc.pm': { label: 'VidSrc (vidsrc.pm)', id: 'any', movie: '/embed/movie/{id}', tv: '/embed/tv/{id}/{s}/{e}' },
  'vidsrc.cc': { label: 'VidSrc (vidsrc.cc)', id: 'any', movie: '/embed/movie/{id}', tv: '/v2/embed/tv/{id}/{s}/{e}' },
  // Vidy: TMDB ids only; supports ?progress=, ?autoplay= and posts playback events to this page
  [VIDY]: { label: 'Vidy', id: 'tmdb', movie: '/movie/{id}?color=F5B301', tv: '/tv/{id}/{s}/{e}?color=F5B301', events: true },
  // vidsrc.xyz / vidsrc.in / vidsrc.net family
  '*': { id: 'any', movie: '/embed/movie/{id}', tv: '/embed/tv/{id}/{s}-{e}' }
};

function domains() {
  const list = (process.env.VIDSRC_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .map(d => (d === 'vidy.st' ? VIDY : d));
  const out = list.length ? list : [...DEFAULT_DOMAINS];
  if (process.env.VIDY !== '0' && !out.includes(VIDY)) out.push(VIDY);
  return out;
}

const sandboxed = () => process.env.VIDSRC_SANDBOX === '1';

function embedUrl(path, id, season = 1, episode = 1) {
  return path.replace('{id}', encodeURIComponent(id)).replace('{s}', season).replace('{e}', episode);
}

// Everything the detail page needs to build and switch the player, or null if no player can play the title.
// `seasons` ([{ n, name, episodes }]) and `tvId` come from TMDB when available.
function player(item, { seasons = null, tvId = null } = {}) {
  const isSeries = item.type === 'Series';
  const options = domains().map(domain => {
    const p = PLAYERS[domain] || PLAYERS['*'];
    const id = p.id === 'tmdb' ? item.tmdb_id : item.imdb_id || item.tmdb_id;
    return id ? { domain, label: p.label || domain, id: String(id), path: p[isSeries ? 'tv' : 'movie'], events: !!p.events } : null;
  }).filter(Boolean);
  if (!options.length) return null;

  const fallbackSeasons = Array.from({ length: item.seasons || 1 }, (_, i) => ({ n: i + 1, name: `Season ${i + 1}`, episodes: null }));
  const seasonList = isSeries ? (seasons?.length ? seasons : fallbackSeasons) : null;
  const first = options[0];
  return {
    src: `https://${first.domain}${embedUrl(first.path, first.id)}`,
    sandbox: sandboxed(),
    isSeries,
    options,
    seasons: seasonList,
    // Client-side config for switching player / episode
    cfg: {
      isSeries,
      tvId,
      key: String(tvId || item.tmdb_id || item.imdb_id),
      players: Object.fromEntries(options.map(o => [o.domain, { id: o.id, path: o.path, events: o.events }])),
      seasons: seasonList
    }
  };
}

module.exports = { domains, player };
