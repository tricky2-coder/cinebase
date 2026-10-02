// Optional TMDB integration (https://www.themoviedb.org) — posters, backdrops, cast, trailers.
// Set TMDB_API_KEY to either a v3 API key or a v4 "API Read Access Token".
const BASE = process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

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
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  return res.json();
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

// Full details mapped to CineBase's title fields
async function details(media, id) {
  const isTv = media === 'tv';
  const d = await call(`/${isTv ? 'tv' : 'movie'}/${id}`, { append_to_response: 'credits,videos,watch/providers' });
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

module.exports = { enabled, search, details };
