// Embedded players: Vidy (default) plus VidSrc & multi-mirror servers for Movies & Series.
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc,vidlink.pro,vidfast.pro,vidnest.fun
//   VIDY=0   hide the Vidy player
const DEFAULT_DOMAINS = ['vidsrc.pm', 'vidsrc.cc', 'vidlink.pro', 'vidfast.pro', 'vidnest.fun'];
const VIDY = 'www.vidy.st';

const SERIES_FLAGS = 'color=F5B301&autoplay=true&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true&progress=0';
const MOVIE_FLAGS = 'color=F5B301&autoplay=true&progress=0';

const PLAYERS = {
  [VIDY]: {
    label: 'Vidy (Default)',
    id: 'tmdb',
    movie: `/movie/{id}?${MOVIE_FLAGS}`,
    tv: `/tv/{id}/{s}/{e}?${SERIES_FLAGS}`,
    events: true
  },
  'vidsrc.pm': {
    label: 'VidSrc (vidsrc.pm)',
    id: 'any',
    movie: '/embed/movie/{id}',
    tv: '/embed/tv/{id}/{s}/{e}'
  },
  'vidsrc.cc': {
    label: 'VidSrc (vidsrc.cc)',
    id: 'any',
    movie: '/v2/embed/movie/{id}',
    tv: '/v2/embed/tv/{id}/{s}/{e}'
  },
  'vidlink.pro': {
    label: 'VidLink',
    id: 'tmdb',
    movie: '/movie/{id}?primaryColor=f5b301&autoplay=true',
    tv: '/tv/{id}/{s}/{e}?primaryColor=f5b301&autoplay=true'
  },
  'vidfast.pro': {
    label: 'VidFast',
    id: 'tmdb',
    movie: '/movie/{id}?theme=F5B301&autoPlay=true',
    tv: '/tv/{id}/{s}/{e}?theme=F5B301&autoPlay=true'
  },
  'vidnest.fun': {
    label: 'VidNest',
    id: 'tmdb',
    movie: '/movie/{id}',
    tv: '/tv/{id}/{s}/{e}'
  },
  '*': {
    id: 'any',
    movie: '/embed/movie/{id}',
    tv: '/embed/tv/{id}/{s}-{e}'
  }
};

function domains() {
  const list = (process.env.VIDSRC_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .map(d => (d === 'vidy.st' ? VIDY : d));
  const out = list.length ? [...new Set([...list, ...DEFAULT_DOMAINS])] : [...DEFAULT_DOMAINS];
  if (process.env.VIDY === '0') return out.filter(d => d !== VIDY);
  return out.includes(VIDY) ? out : [VIDY, ...out];
}

function player(item, { seasons = null, tvId = null, initialEpisodes = null } = {}) {
  const isSeries = item.type === 'Series';
  const isAnime = Boolean(item.anilist_id);
  const id = isAnime ? String(item.anilist_id) : String(item.tmdb_id || item.imdb_id);
  if (!id) return null;

  const fallbackSeasons = Array.from({ length: item.seasons || 1 }, (_, i) => ({ n: i + 1, name: `Season ${i + 1}`, episodes: null }));
  const seasonList = isSeries ? (seasons?.length ? seasons : fallbackSeasons) : null;

  if (isAnime) {
    const path = isSeries ? `/anime/{id}/{e}?${SERIES_FLAGS}` : `/anime/{id}/1?${MOVIE_FLAGS}`;
    const initialSrc = `https://${VIDY}` + path.replace('{id}', encodeURIComponent(id)).replace('{e}', '1');
    return {
      src: initialSrc,
      isSeries,
      isAnime: true,
      options: [{ domain: VIDY, label: 'Vidy', id, path, events: true }],
      seasons: seasonList,
      cfg: {
        isSeries,
        anime: true,
        tvId: null,
        key: `a${id}`,
        epBase: `/episodes/anime/${id}/`,
        path,
        id,
        domain: VIDY,
        players: { [VIDY]: { id, path, events: true } },
        seasons: seasonList,
        initialEpisodes: initialEpisodes || null
      }
    };
  }

  const options = domains().map(domain => {
    const p = PLAYERS[domain] || PLAYERS['*'];
    const pid = p.id === 'tmdb' ? (item.tmdb_id || item.imdb_id) : (item.imdb_id || item.tmdb_id);
    if (!pid) return null;
    return {
      domain,
      label: p.label || domain,
      id: String(pid),
      path: p[isSeries ? 'tv' : 'movie'],
      events: Boolean(p.events)
    };
  }).filter(Boolean);

  if (!options.length) return null;

  const first = options[0];
  const initialSrc = `https://${first.domain}` + first.path
    .replace('{id}', encodeURIComponent(first.id))
    .replace('{s}', '1')
    .replace('{e}', '1');

  return {
    src: initialSrc,
    isSeries,
    isAnime: false,
    options,
    seasons: seasonList,
    cfg: {
      isSeries,
      anime: false,
      tvId: tvId || item.tmdb_id || null,
      key: String(tvId || item.tmdb_id || item.imdb_id),
      epBase: tvId ? `/episodes/${tvId}/` : null,
      path: first.path,
      id: first.id,
      domain: first.domain,
      players: Object.fromEntries(options.map(o => [o.domain, { id: o.id, path: o.path, events: o.events }])),
      seasons: seasonList,
      initialEpisodes: initialEpisodes || null
    }
  };
}

module.exports = { domains, player, VIDY };
