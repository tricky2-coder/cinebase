// Optional TMDB integration (https://www.themoviedb.org) — posters, backdrops, cast, trailers,
// plus the live public catalogue (trending, popular, discover, search, title pages).
// Set TMDB_API_KEY to either a v3 API key or a v4 "API Read Access Token".
const BASE = process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const HOUR = 60 * 60 * 1000;

const key = () => (process.env.TMDB_API_KEY || '').trim();
const enabled = () => !!key();

async function call(endpoint, params = {}) {
  if (!enabled()) throw new Error('TMDB_API_KEY is not set');
  const url = new URL(BASE + endpoint);
  const headers = { Accept: 'application/json' };
  // v4 read tokens are long JWTs; v3 keys are 32 hex chars
  if (key().length > 40) headers.Authorization = `Bearer ${key()}`;
  else url.searchParams.set('api_key', key());
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw Object.assign(new Error(`TMDB ${res.status}: ${res.statusText}`), { status: res.status });
  return res.json();
}

// Small in-memory cache (per server instance) so pages stay fast and well under TMDB's rate limits
const cache = new Map();
const CACHE_MAX = 500;
async function cached(cacheKey, ttlMs, fn) {
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.delete(cacheKey);
  cache.set(cacheKey, { exp: Date.now() + ttlMs, value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

async function search(query, year) {
  const data = await call('/search/multi', { query, include_adult: 'false', year });
  return data.results
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 10)
    .map(r => ({
      tmdb_id: r.id,
      media: r.media_type,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      poster: r.poster_path ? `${IMG}/w185${r.poster_path}` : null
    }));
}

const LANGS = { en: 'English', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', ko: 'Korean', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese' };
const GENRE_MAP = { 'Science Fiction': 'Sci-Fi', 'Sci-Fi & Fantasy': 'Sci-Fi', 'Action & Adventure': 'Action', 'War & Politics': 'Drama' };

// Full TMDB record, shared by the admin auto-fill, the enrich job and the public title pages
const raw = (media, id) => cached(`full:${media}:${id}`, 6 * HOUR, () =>
  call(`/${media === 'tv' ? 'tv' : 'movie'}/${id}`, { append_to_response: 'credits,videos,watch/providers,external_ids,recommendations' }));

// Full details mapped to CineBase's title fields
function mapDetails(media, d) {
  const isTv = media === 'tv';
  const trailer = (d.videos?.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || (d.videos?.results || []).find(v => v.site === 'YouTube');
  const director = isTv
    ? (d.created_by || []).map(c => c.name).join(', ')
    : (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', ');
  const providers = d['watch/providers']?.results?.IN?.flatrate || [];
  const genre = d.genres?.[0]?.name;
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const status = isTv
    ? (d.status === 'Ended' || d.status === 'Canceled' ? 'Ended' : d.in_production ? 'Ongoing' : 'Released')
    : (d.status === 'Released' ? 'Released' : 'Upcoming');

  return {
    tmdb_id: d.id,
    imdb_id: d.external_ids?.imdb_id || d.imdb_id || '',
    title: d.title || d.name,
    type: isTv ? 'Series' : 'Movie',
    genre: GENRE_MAP[genre] || genre || '',
    language: LANGS[d.original_language] || d.original_language || '',
    release_year: year ? parseInt(year, 10) : '',
    director: director || '',
    cast_members: (d.credits?.cast || []).slice(0, 6).map(c => c.name).join(', '),
    seasons: isTv ? d.number_of_seasons : '',
    duration_min: isTv ? (d.episode_run_time?.[0] || '') : (d.runtime || ''),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : '',
    platform: providers[0]?.provider_name || '',
    status,
    synopsis: d.overview || '',
    poster_url: d.poster_path ? `${IMG}/w500${d.poster_path}` : '',
    backdrop_url: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : '',
    trailer_key: trailer?.key || ''
  };
}

async function details(media, id) {
  return mapDetails(media, await raw(media, id));
}

// ---------- Live catalogue ----------

// Genre id -> name for movies and series (ids are shared where names match)
const genreList = media => cached(`genres:${media}`, 24 * HOUR, async () =>
  (await call(`/genre/${media}/list`)).genres);
async function genreNames() {
  const [m, t] = await Promise.all([genreList('movie'), genreList('tv')]);
  return Object.fromEntries([...m, ...t].map(g => [g.id, g.name]));
}

// A TMDB list result in the same shape as a CineBase card (views/site/_card.ejs)
function toCard(r, media, names) {
  const m = r.media_type || media;
  const isTv = m === 'tv';
  const g = names[r.genre_ids?.[0]];
  return {
    id: r.id,
    tmdb_id: r.id,
    href: `/${isTv ? 'tv' : 'm'}/${r.id}`,
    title: r.title || r.name,
    type: isTv ? 'Series' : 'Movie',
    genre: GENRE_MAP[g] || g || '',
    release_year: (r.release_date || r.first_air_date || '').slice(0, 4),
    rating: r.vote_count ? Math.round(r.vote_average * 10) / 10 : null,
    language: LANGS[r.original_language] || r.original_language || '',
    synopsis: r.overview || null,
    poster_url: r.poster_path ? `${IMG}/w342${r.poster_path}` : null,
    backdrop_url: r.backdrop_path ? `${IMG}/w1280${r.backdrop_path}` : null
  };
}

const isTitle = (r, media) => ['movie', 'tv'].includes(r.media_type || media);

function listPage(endpoint, params, media) {
  return cached(`list:${endpoint}?${new URLSearchParams(params)}`, 3 * HOUR, async () => {
    const [d, names] = await Promise.all([call(endpoint, { include_adult: 'false', ...params }), genreNames()]);
    return {
      page: d.page || 1,
      pages: Math.max(1, Math.min(d.total_pages || 1, 500)), // TMDB serves at most 500 pages
      total: d.total_results || 0,
      items: (d.results || []).filter(r => isTitle(r, media)).map(r => toCard(r, media, names))
    };
  });
}

const trending = () => listPage('/trending/all/week', {}, null);
const popular = media => listPage(`/${media}/popular`, {}, media);
const topRated = media => listPage(`/${media}/top_rated`, {}, media);
const searchAll = (query, page = 1) => listPage('/search/multi', { query, page }, null);

function discover(media, { genre, year, language, sort, page = 1 }) {
  const isTv = media === 'tv';
  const p = { page };
  if (sort === 'rating') {
    p.sort_by = 'vote_average.desc';
    // Enough votes to be meaningful; regional/yearly slices have far fewer voters
    p['vote_count.gte'] = language || year ? 20 : isTv ? 100 : 300;
  } else if (sort === 'newest') {
    p.sort_by = isTv ? 'first_air_date.desc' : 'primary_release_date.desc';
    p[isTv ? 'first_air_date.lte' : 'primary_release_date.lte'] = new Date().toISOString().slice(0, 10);
    p['vote_count.gte'] = 10;
  } else {
    p.sort_by = 'popularity.desc';
  }
  if (genre) p.with_genres = genre;
  if (year) p[isTv ? 'first_air_date_year' : 'primary_release_year'] = year;
  if (language) p.with_original_language = language;
  return listPage(`/discover/${media}`, p, media);
}

// Everything a public title page needs
async function titlePage(media, id) {
  const [d, names] = await Promise.all([raw(media, id), genreNames()]);
  return {
    item: mapDetails(media, d),
    similar: (d.recommendations?.results || []).filter(r => isTitle(r, media)).slice(0, 20).map(r => toCard(r, media, names))
  };
}

module.exports = { enabled, search, details, LANGS, genreList, trending, popular, topRated, discover, searchAll, titlePage };
