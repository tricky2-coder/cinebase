// AniList (https://anilist.co) — the anime catalogue. No key needed. Anime play through
// Vidy's /anime/{anilistId}/{episode} route, so anime titles use AniList ids end to end.
// AniList allows ~30 requests/minute per server, so everything is cached for hours.
const API = 'https://graphql.anilist.co';
const HOUR = 60 * 60 * 1000;
const EPISODE_CHUNK = 100; // long shows get episode tabs 1–100, 101–200, …

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const SORTS = { popular: 'POPULARITY_DESC', trending: 'TRENDING_DESC', rating: 'SCORE_DESC', newest: 'START_DATE_DESC' };
const FORMATS = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };

const cache = new Map();
const CACHE_MAX = 300;
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.delete(key);
  cache.set(key, { exp: Date.now() + ttlMs, value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const status = res.status === 200 ? (json.errors?.[0]?.status || 500) : res.status;
    throw Object.assign(new Error(`AniList ${status}: ${json.errors?.[0]?.message || res.statusText}`), { status });
  }
  return json.data;
}

const CARD_FIELDS = `id title { romaji english } format episodes seasonYear averageScore status
  coverImage { large extraLarge } bannerImage genres description(asHtml: false)`;

const titleOf = m => m.title.english || m.title.romaji;
const stripHtml = s => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

// AniList media -> the card shape used by views/site/_card.ejs
function toCard(m) {
  return {
    id: m.id,
    anilist_id: m.id,
    href: `/a/${m.id}`,
    title: titleOf(m),
    type: m.format === 'MOVIE' ? 'Anime Movie' : 'Anime',
    genre: m.genres?.[0] || '',
    release_year: m.seasonYear || '',
    rating: m.averageScore ? Math.round(m.averageScore) / 10 : null,
    language: 'Japanese',
    synopsis: stripHtml(m.description) || null,
    poster_url: m.coverImage?.large || null,
    backdrop_url: m.bannerImage || m.coverImage?.extraLarge || null
  };
}

// One page of anime. opts: { sort, genre, format ('MOVIE' | 'series'), year, search, page }
// Only filters in use go into the query: AniList rejects some arguments when they are null.
const FILTERS = {
  genre: ['String', 'genre'],
  format: ['MediaFormat', 'format'],
  formatIn: ['[MediaFormat]', 'format_in'],
  year: ['Int', 'seasonYear'],
  search: ['String', 'search'],
  statusNot: ['MediaStatus', 'status_not'],
  minPopularity: ['Int', 'popularity_greater']
};
function list({ sort = 'popular', genre, format, year, search, page = 1, perPage = 20 } = {}) {
  const filters = {
    genre: genre || null,
    format: format === 'MOVIE' ? 'MOVIE' : null,
    formatIn: format === 'series' ? ['TV', 'TV_SHORT', 'ONA'] : null,
    year: year ? Number(year) : null,
    search: search || null,
    statusNot: 'NOT_YET_RELEASED',                        // upcoming titles can't be watched yet
    minPopularity: sort === 'rating' && !search ? 5000 : null // top rated needs enough votes to mean something
  };
  const used = Object.keys(filters).filter(k => filters[k] != null);
  const vars = { page, perPage, sort: search ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : [SORTS[sort] || SORTS.popular] };
  for (const k of used) vars[k] = filters[k];
  const decl = ['$page: Int', '$perPage: Int', '$sort: [MediaSort]', ...used.map(k => `$${k}: ${FILTERS[k][0]}`)].join(', ');
  const args = ['type: ANIME', 'isAdult: false', 'sort: $sort', 'genre_not_in: ["Hentai"]', ...used.map(k => `${FILTERS[k][1]}: $${k}`)].join(', ');
  return cached(`list:${JSON.stringify(vars)}`, 3 * HOUR, async () => {
    const d = await gql(`query (${decl}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total lastPage currentPage }
        media(${args}) { ${CARD_FIELDS} }
      }
    }`, vars);
    const p = d.Page;
    return { page: p.pageInfo.currentPage || page, pages: Math.max(1, Math.min(p.pageInfo.lastPage || 1, 500)), total: p.pageInfo.total || 0, items: p.media.map(toCard) };
  });
}

// Full anime record (title page, episode list, hover-preview trailer)
const media = id => cached(`media:${id}`, 6 * HOUR, async () => (await gql(`query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${CARD_FIELDS}
    title { romaji english native } status duration season
    trailer { id site }
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode }
    streamingEpisodes { title thumbnail }
    characters(sort: [ROLE, RELEVANCE], perPage: 20) {
      edges { role node { name { full } image { large } } voiceActors(language: JAPANESE) { name { full } } }
    }
    relations { edges { relationType node { ${CARD_FIELDS} type } } }
    recommendations(perPage: 20, sort: RATING_DESC) { nodes { mediaRecommendation { ${CARD_FIELDS} } } }
  }
}`, { id: Number(id) })).Media);

// Episodes that can be watched now: aired so far for running shows, otherwise the total (null = unknown)
function availableEpisodes(m) {
  if (m.format === 'MOVIE') return 1;
  if (m.nextAiringEpisode?.episode) return m.nextAiringEpisode.episode - 1;
  if (m.episodes) return m.episodes;
  // Running show without a schedule (e.g. on break): fall back to the highest numbered streaming episode
  const nums = (m.streamingEpisodes || []).map(e => parseInt((e.title.match(/Episode\s+(\d+)/i) || [])[1], 10)).filter(Boolean);
  return nums.length ? Math.max(...nums) : null;
}

const RELATION_LABELS = { PREQUEL: 'Prequel', SEQUEL: 'Sequel', PARENT: 'Main story', SIDE_STORY: 'Side story', SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Alternative', SUMMARY: 'Summary' };

// Everything the anime title page needs
async function titlePage(id) {
  const m = await media(id);
  if (!m) throw Object.assign(new Error('AniList 404'), { status: 404 });
  const count = availableEpisodes(m);
  const isMovie = m.format === 'MOVIE';
  const item = {
    ...toCard(m),
    type: isMovie ? 'Movie' : 'Series',          // drives the player (single video vs episodes)
    kind: FORMATS[m.format] ? `Anime · ${FORMATS[m.format]}` : 'Anime',
    seasons: null,
    duration_min: m.duration || null,
    status: { FINISHED: 'Ended', RELEASING: 'Ongoing', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Ended', HIATUS: 'On hiatus' }[m.status] || 'Released',
    platform: m.studios?.nodes?.[0]?.name || '',
    director: null,
    cast_members: null,
    trailer_key: m.trailer?.site === 'youtube' && /^[\w-]{11}$/.test(m.trailer.id) ? m.trailer.id : null,
    native_title: m.title.native || null,
    episode_count: count
  };
  // Episode "seasons": one tab for short shows, 100-episode tabs for long ones
  const seasons = isMovie ? null : count
    ? Array.from({ length: Math.ceil(count / EPISODE_CHUNK) }, (_, i) => {
      const start = i * EPISODE_CHUNK + 1, end = Math.min(count, start + EPISODE_CHUNK - 1);
      return { n: i + 1, name: count <= EPISODE_CHUNK ? 'Episodes' : `${start}–${end}`, episodes: end - start + 1, start };
    })
    : [{ n: 1, name: 'Episodes', episodes: null, start: 1 }];
  return {
    item,
    seasons,
    cast: (m.characters?.edges || []).map(e => ({
      name: e.node.name.full,
      character: e.voiceActors?.[0]?.name.full ? `CV: ${e.voiceActors[0].name.full}` : (e.role === 'MAIN' ? 'Main' : ''),
      photo: e.node.image?.large || null
    })),
    related: (m.relations?.edges || [])
      .filter(e => e.node.type === 'ANIME' && RELATION_LABELS[e.relationType])
      .map(e => ({ ...toCard(e.node), type: RELATION_LABELS[e.relationType] })),
    similar: (m.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(Boolean).map(toCard)
  };
}

// Episodes in one tab (chunk) of an anime, with names/thumbnails where AniList has them
async function episodes(id, chunk) {
  const m = await media(id);
  if (!m) throw Object.assign(new Error('AniList 404'), { status: 404 });
  const count = availableEpisodes(m);
  if (!count) return [];
  const start = (chunk - 1) * EPISODE_CHUNK + 1;
  if (start > count) throw Object.assign(new Error('No such episodes'), { status: 404 });
  const end = Math.min(count, start + EPISODE_CHUNK - 1);
  const named = new Map();
  for (const e of m.streamingEpisodes || []) {
    const [, num, name] = e.title.match(/Episode\s+(\d+)\s*-\s*(.*)/i) || [];
    if (num) named.set(Number(num), { name: name.trim(), still: e.thumbnail });
  }
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const n = start + i;
    return { n, name: named.get(n)?.name || `Episode ${n}`, still: named.get(n)?.still || null, runtime: m.duration || null, air_date: null, aired: true };
  });
}

async function trailer(id) {
  const m = await media(id);
  return m?.trailer?.site === 'youtube' && /^[\w-]{11}$/.test(m.trailer.id) ? m.trailer.id : null;
}

// Best AniList match for a TMDB title (used to link TMDB anime pages to the anime player)
const match = (title, year) => cached(`match:${title}:${year}`, 24 * HOUR, async () => {
  const d = await gql(`query ($search: String) { Page(perPage: 5) { media(type: ANIME, search: $search, isAdult: false, sort: [SEARCH_MATCH]) { id seasonYear format } } }`, { search: title });
  const hits = d.Page.media;
  return (hits.find(h => year && h.seasonYear === Number(year)) || hits[0])?.id || null;
});

module.exports = { GENRES, SORTS, list, titlePage, episodes, trailer, match, toCard };
