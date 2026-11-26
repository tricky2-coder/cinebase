// Embedded players: Vidy (default) plus VidSrc & multi-mirror servers for Movies & Series.
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc,vidlink.pro,vidfast.pro,vidnest.fun
//   VIDY=0   hide the Vidy player
const DEFAULT_DOMAINS = ['embed.pstream.cfd', 'vidrock.net', 'vidsrc.me', 'vidlink.pro', 'vidfast.pro', 'vidnest.fun', 'vidsrc.pm', 'vidsrc.cc', 'www.2embed.cc'];
const VIDY = 'www.vidy.st';

const SERIES_FLAGS = 'color=F5B301&autoplay=true&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true&progress=0';
const MOVIE_FLAGS = 'color=F5B301&autoplay=true&progress=0';

const PLAYERS = {
  [VIDY]: {
    label: 'Vidy (Default)',
    id: 'tmdb',
    movie: `/movie/{id}?${MOVIE_FLAGS}`,
    tv: `/tv/{id}/{s}/{e}?${SERIES_FLAGS}`,
    startParam: 'progress'
  },
  'embed.pstream.cfd': {
    label: 'P-Stream',
    id: 'tmdb',
    movie: '/movie/{id}?autoplay=1&autonext=0&title=0&logo=0&overlay=1&markers=1&boost=1&seek=1&fill=1&cast=1&lang=en',
    tv: '/tv/{id}/{s}/{e}?autoplay=1&autonext=0&episodes=1&title=0&logo=0&overlay=1&markers=1&boost=1&seek=1&fill=1&cast=1&lang=en',
    startParam: 't'
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
  'vidsrc.me': {
    label: 'VidSrc (vidsrc.me)',
    id: 'tmdb',
    movie: '/embed/movie?tmdb={id}',
    tv: '/embed/tv?tmdb={id}&season={s}&episode={e}'
  },
  'vidrock.net': {
    label: 'VidRock',
    id: 'tmdb',
    movie: '/movie/{id}?autoplay=true&theme=F5B301',
    tv: '/tv/{id}/{s}/{e}?autoplay=true&theme=F5B301'
  },
  'www.2embed.cc': {
    label: '2Embed',
    id: 'tmdb',
    movie: '/embed/{id}',
    tv: '/embedtv/{id}&s={s}&e={e}'
  },
  'vidlink.pro': {
    label: 'VidLink',
    id: 'tmdb',
    movie: '/movie/{id}?primaryColor=f5b301&autoplay=true',
    tv: '/tv/{id}/{s}/{e}?primaryColor=f5b301&autoplay=true',
    startParam: 'startAt'
  },
  'vidfast.pro': {
    label: 'VidFast',
    id: 'tmdb',
    movie: '/movie/{id}?theme=F5B301&autoPlay=true',
    tv: '/tv/{id}/{s}/{e}?theme=F5B301&autoPlay=true',
    startParam: 'startAt'
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
        title: item.title || '',
        year: item.release_year || '',
        tmdbId: item.tmdb_id || null,
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

  let serverIdx = 0;
  const options = domains().map(domain => {
    const p = PLAYERS[domain] || PLAYERS['*'];
    const pid = p.id === 'tmdb' ? (item.tmdb_id || item.imdb_id) : (item.imdb_id || item.tmdb_id);
    if (!pid) return null;
    const label = domain === VIDY ? 'Vidy' : `Server ${++serverIdx}`;
    return {
      domain,
      label,
      id: String(pid),
      path: p[isSeries ? 'tv' : 'movie'],
      startParam: p.startParam || null
    };
  }).filter(Boolean);

  if (!options.length) return null;

  // Order: Vidy (Default) -> Server 1 (P-Stream) -> Artplayer (Auto) -> Server 2..N
  const pstreamIdx = options.findIndex(o => o.domain === 'embed.pstream.cfd');
  const vidyIdx = options.findIndex(o => o.domain === VIDY);
  const artOpt = { domain: 'artplayer', label: 'Artplayer (Auto)', id: String(item.tmdb_id || item.imdb_id), path: '', startParam: null };
  if (pstreamIdx >= 0) options.splice(pstreamIdx + 1, 0, artOpt);
  else if (vidyIdx >= 0) options.splice(vidyIdx + 1, 0, artOpt);
  else options.unshift(artOpt);

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
      title: item.title || '',
      year: item.release_year || '',
      tmdbId: item.tmdb_id || null,
      tvId: tvId || item.tmdb_id || null,
      key: String(tvId || item.tmdb_id || item.imdb_id),
      epBase: tvId ? `/episodes/${tvId}/` : null,
      path: first.path,
      id: first.id,
      domain: first.domain,
      players: Object.fromEntries(options.map(o => [o.domain, { id: o.id, path: o.path, startParam: o.startParam }])),
      seasons: seasonList,
      initialEpisodes: initialEpisodes || null
    }
  };
}

module.exports = { domains, player, VIDY };
