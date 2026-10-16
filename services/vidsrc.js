// Embedded players: Vidy (default) plus VidSrc mirrors. Viewers pick one from the "Player" menu.
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc   VidSrc mirrors, listed after Vidy (include vidy.st to place it elsewhere)
//   VIDY=0                               hide the Vidy player
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
  // autoplay=true: starts as soon as a stream is found when the browser allows it, otherwise shows a play button
  [VIDY]: { label: 'Vidy', id: 'tmdb', movie: '/movie/{id}?color=F5B301&autoplay=true', tv: '/tv/{id}/{s}/{e}?color=F5B301&autoplay=true', events: true },
  // Anime: AniList id + absolute episode number ({e}); only Vidy supports AniList ids
  'vidy-anime': { label: 'Vidy', domain: VIDY, movie: '/anime/{id}/1?color=F5B301&autoplay=true', tv: '/anime/{id}/{e}?color=F5B301&autoplay=true', events: true },
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
  if (process.env.VIDY === '0') return out.filter(d => d !== VIDY);
  return out.includes(VIDY) ? out : [VIDY, ...out]; // Vidy is the default player
}

const sandboxed = () => process.env.VIDSRC_SANDBOX === '1';

function embedUrl(path, id, season = 1, episode = 1) {
  return path.replace('{id}', encodeURIComponent(id)).replace('{s}', season).replace('{e}', episode);
}

// Everything the detail page needs to build and switch the player, or null if no player can play the title.
// `seasons` ([{ n, name, episodes, start? }]) and `tvId` come from TMDB (or AniList for anime) when available.
function player(item, { seasons = null, tvId = null } = {}) {
  const isSeries = item.type === 'Series';
  if (item.anilist_id) return animePlayer(item, seasons, isSeries);
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
      epBase: tvId ? `/episodes/${tvId}/` : null,
      players: Object.fromEntries(options.map(o => [o.domain, { id: o.id, path: o.path, events: o.events }])),
      seasons: seasonList
    }
  };
}

function animePlayer(item, seasons, isSeries) {
  if (process.env.VIDY === '0') return null;
  const p = PLAYERS['vidy-anime'];
  const id = String(item.anilist_id);
  const path = p[isSeries ? 'tv' : 'movie'];
  const seasonList = isSeries ? seasons : null;
  return {
    src: `https://${p.domain}${embedUrl(path, id, 1, 1)}`,
    sandbox: sandboxed(),
    isSeries,
    options: [{ domain: p.domain, label: p.label, id, path, events: true }],
    seasons: seasonList,
    cfg: {
      isSeries,
      anime: true,
      tvId: null,
      epBase: `/episodes/anime/${id}/`,
      key: `a${id}`,
      players: { [p.domain]: { id, path, events: true } },
      seasons: seasonList
    }
  };
}

module.exports = { domains, player };
