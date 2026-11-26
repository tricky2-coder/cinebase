// Public, read-only frontend: live TMDB catalogue (when TMDB_API_KEY is set) plus your own CineBase titles
const express = require('express');
const db = require('../db');
const plex = require('../services/plex');
const tmdb = require('../services/tmdb');
const vidsrc = require('../services/vidsrc');
const anilist = require('../services/anilist');
const anivexa = require('../services/anivexa');
const mediaStreams = require('../services/media-streams');

const router = express.Router();
const CARD_COLS = 'id,title,type,genre,release_year,rating,poster_url,backdrop_url,trailer_key,tmdb_id,anilist_id,plex_rating_key';
const BROWSE_PAGE_SIZE = 24;
const DISCOVER_SORTS = { popular: 'Most popular', rating: 'Top rated', newest: 'Newest' };
const ANIME_SORTS = { popular: 'Most popular', trending: 'Trending now', rating: 'Top rated', newest: 'Newest' };
// What /discover?type= can show. Anime comes from AniList (played via Vidy's /anime/{anilistId}/{episode}).
const DISCOVER_TYPES = {
  movie: { media: 'movie', label: 'Movies' },
  tv: { media: 'tv', label: 'Series' },
  anime: { anilist: 'series', label: 'Anime' },
  'anime-movie': { anilist: 'MOVIE', label: 'Anime Movies' }
};
// Genres that don't make useful categories
const SKIP_GENRES = new Set(['TV Movie', 'News', 'Talk', 'Reality', 'Soap']);

router.use((req, res, next) => {
  res.locals.plexEnabled = plex.enabled();
  res.locals.tmdbEnabled = tmdb.enabled();
  res.locals.q = '';
  res.locals.query = req.query;
  next();
});

const aniDown = (res, e) => {
  console.error('AniList request failed:', e.message);
  const busy = e.status === 429;
  res.status(busy ? 503 : 502).render('error', {
    title: 'Anime unavailable',
    message: busy ? 'The anime catalogue is busy right now. Please try again in a minute.' : 'Could not load anime from AniList right now. Please try again.'
  });
};
const tmdbDown = (res, e) => {
  console.error('TMDB request failed:', e.message);
  res.status(502).render('error', { title: 'TMDB unavailable', message: 'Could not load titles from TMDB right now. Please try again.' });
};
const pageParam = (v, max = 500) => Math.min(Math.max(1, parseInt(v, 10) || 1), max);
const withHref = rows => rows.map(r => ({ ...r, href: `/t/${r.id}` }));
const localCards = (sql, ...args) => db.all(sql, ...args);

// HOME
router.get('/', async (req, res) => {
  anivexa.wakeUp();
  let hero = [];
  let rows = [];
  if (tmdb.enabled()) {
    const specs = [
      ['Trending This Week', null, () => tmdb.trending()],
      ['Popular Movies', '/discover?type=movie', () => tmdb.popular('movie')],
      ['Popular Series', '/discover?type=tv', () => tmdb.popular('tv')],
      ['Trending Anime', '/discover?type=anime&sort=trending', () => anilist.list({ sort: 'trending', format: 'series' })],
      ['Top Rated Movies', '/discover?type=movie&sort=rating', () => tmdb.topRated('movie')],
      ['Top Rated Series', '/discover?type=tv&sort=rating', () => tmdb.topRated('tv')],
      ['Action Movies', '/discover?type=movie&genre=28', () => tmdb.discover('movie', { genre: 28 })],
      ['Hindi Movies', '/discover?type=movie&language=hi', () => tmdb.discover('movie', { language: 'hi' })],
      ['Comedy Movies', '/discover?type=movie&genre=35', () => tmdb.discover('movie', { genre: 35 })],
      ['Anime Movies', '/discover?type=anime-movie', () => anilist.list({ format: 'MOVIE' })],
      ['Horror Movies', '/discover?type=movie&genre=27', () => tmdb.discover('movie', { genre: 27 })],
      ['Sci-Fi & Fantasy Series', '/discover?type=tv&genre=10765', () => tmdb.discover('tv', { genre: 10765 })],
      ['Romance Movies', '/discover?type=movie&genre=10749', () => tmdb.discover('movie', { genre: 10749 })],
      ['Crime Series', '/discover?type=tv&genre=80', () => tmdb.discover('tv', { genre: 80 })],
      ['Thriller Movies', '/discover?type=movie&genre=53', () => tmdb.discover('movie', { genre: 53 })],
      ['Korean Series', '/discover?type=tv&language=ko', () => tmdb.discover('tv', { language: 'ko' })],
      ['Documentaries', '/discover?type=movie&genre=99', () => tmdb.discover('movie', { genre: 99 })],
      ['Family Movies', '/discover?type=movie&genre=10751', () => tmdb.discover('movie', { genre: 10751 })]
    ];
    // One failing row shouldn't empty the whole home page
    const results = await Promise.allSettled(specs.map(([, , load]) => load()));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') rows.push({ name: specs[i][0], link: specs[i][1], items: r.value.items });
      else console.error(`TMDB row "${specs[i][0]}" failed:`, r.reason?.message);
    });
    if (results[0].status === 'fulfilled') hero = results[0].value.items.filter(i => i.backdrop_url).slice(0, 5);
  }

  if (rows.length) {
    // TMDB covers the big rows; show what's specific to this CineBase
    rows.push(
      { name: 'Your CineBase', link: '/browse?sort=new', items: await localCards(`SELECT ${CARD_COLS} FROM titles ORDER BY id DESC LIMIT 20`) },
      { name: 'On Your Plex', link: '/browse?source=plex', items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE plex_rating_key IS NOT NULL ORDER BY updated_at DESC LIMIT 20`) }
    );
  } else {
    const localHero = (await db.all('SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND rating IS NOT NULL ORDER BY rating DESC LIMIT 5'));
    hero = withHref(localHero.length ? localHero : (await db.all('SELECT * FROM titles ORDER BY rating DESC LIMIT 5')));
    rows = [
      { name: 'Recently Added', link: '/browse?sort=new', items: await localCards(`SELECT ${CARD_COLS} FROM titles ORDER BY id DESC LIMIT 20`) },
      { name: 'Top Rated', link: '/browse?sort=rating', items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 20`) },
      { name: 'On Your Plex', link: '/browse?source=plex', items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE plex_rating_key IS NOT NULL ORDER BY updated_at DESC LIMIT 20`) },
      { name: 'Movies', link: '/browse?type=Movie', items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE type='Movie' ORDER BY release_year DESC LIMIT 20`) },
      { name: 'Series', link: '/browse?type=Series', items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE type='Series' ORDER BY release_year DESC LIMIT 20`) }
    ];
    // Include live Anime from AniList (free public GraphQL, no API key required) for local anime browsing & testing
    try {
      const [trendingAnime, animeMovies] = await Promise.allSettled([
        anilist.list({ sort: 'trending', format: 'series' }),
        anilist.list({ format: 'MOVIE' })
      ]);
      if (trendingAnime.status === 'fulfilled' && trendingAnime.value?.items?.length) {
        rows.splice(1, 0, { name: 'Trending Anime', link: '/discover?type=anime&sort=trending', items: trendingAnime.value.items });
      }
      if (animeMovies.status === 'fulfilled' && animeMovies.value?.items?.length) {
        rows.push({ name: 'Anime Movies', link: '/discover?type=anime-movie', items: animeMovies.value.items });
      }
    } catch (e) {
      console.error('AniList local rows failed:', e.message);
    }
    const genres = (await db.all('SELECT genre, COUNT(*) c FROM titles GROUP BY genre HAVING c >= 2 ORDER BY c DESC LIMIT 6'));
    for (const g of genres) {
      rows.push({ name: g.genre, link: `/browse?genre=${encodeURIComponent(g.genre)}`, items: await localCards(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? ORDER BY rating DESC LIMIT 20`, g.genre) });
    }
  }

  // Prepend personal profile rows: Continue Watching above My Watchlist
  if (req.session.user && req.session.activeProfileId) {
    try {
      const personalRows = [];
      const historyRows = await db.all(
        'SELECT * FROM watch_history WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 20',
        req.session.activeProfileId
      );
      if (historyRows && historyRows.length) {
        personalRows.push({
          name: 'Continue Watching',
          link: '/history',
          items: historyRows.map(h => ({
            id: h.media_id,
            title: h.title,
            poster_url: h.poster_url,
            href: h.href,
            type: h.media_type === 'movie' ? 'Movie' : (h.media_type === 'anime' ? 'Anime' : 'Series'),
            progress_seconds: h.progress_seconds,
            duration_seconds: h.duration_seconds
          }))
        });
      }

      const watchlistRows = await db.all(
        'SELECT * FROM watchlists WHERE profile_id = ? ORDER BY id DESC LIMIT 20',
        req.session.activeProfileId
      );
      if (watchlistRows && watchlistRows.length) {
        personalRows.push({
          name: 'My Watchlist',
          link: '/watchlist',
          items: watchlistRows.map(w => ({
            id: w.media_id,
            title: w.title,
            poster_url: w.poster_url,
            href: w.href,
            type: w.media_type === 'movie' ? 'Movie' : (w.media_type === 'anime' ? 'Anime' : 'Series'),
            rating: w.rating,
            release_year: w.release_year
          }))
        });
      }

      if (personalRows.length) {
        rows.unshift(...personalRows);
      }
    } catch (err) {
      console.error('Error fetching profile rows for home:', err.message);
    }
  }

  res.render('site/home', { title: 'Home', hero, rows: rows.filter(r => r.items.length) });
});

// DISCOVER — the full TMDB catalogue with filters
router.get('/discover', async (req, res) => {
  const type = DISCOVER_TYPES[req.query.type] ? req.query.type : 'movie';
  const { media, label, keywords, anilist: aniFormat } = DISCOVER_TYPES[type];
  if (aniFormat) {
    anivexa.wakeUp();
    return animeDiscover(req, res, type, label, aniFormat);
  }
  if (!tmdb.enabled()) return res.redirect('/browse');
  try {
    const genres = (await tmdb.genreList(media)).filter(g => !SKIP_GENRES.has(g.name));
    const genre = genres.find(g => String(g.id) === req.query.genre);
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : '';
    const language = tmdb.LANGS[req.query.language] ? req.query.language : '';
    const sort = DISCOVER_SORTS[req.query.sort] ? req.query.sort : 'popular';
    const result = await tmdb.discover(media, { genre: genre?.id, year, language, sort, keywords, page: pageParam(req.query.page) });

    const heading = [genre?.name, language && tmdb.LANGS[language], label].filter(Boolean).join(' ') + (year ? ` (${year})` : '');
    const qs = new URLSearchParams({ type, ...(genre && { genre: genre.id }), ...(language && { language }), ...(year && { year }), sort });
    // Category chips keep the other filters and start again at page 1
    const chipQs = new URLSearchParams({ type, ...(language && { language }), ...(year && { year }), ...(sort !== 'popular' && { sort }) }).toString();
    res.render('site/discover', {
      title: heading, heading, isSearch: false, local: [], anime: [], ...result,
      type, types: DISCOVER_TYPES, media, genres, genre: genre ? String(genre.id) : '', year, language, sort,
      sorts: DISCOVER_SORTS, languages: tmdb.LANGS, qs: qs.toString(), chipQs
    });
  } catch (e) { tmdbDown(res, e); }
});

async function animeDiscover(req, res, type, label, format) {
  const genre = anilist.GENRES.includes(req.query.genre) ? req.query.genre : '';
  const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : '';
  const sort = ANIME_SORTS[req.query.sort] ? req.query.sort : 'popular';
  try {
    const result = await anilist.list({ sort, genre, format, year, page: pageParam(req.query.page) });
    const heading = [genre, label].filter(Boolean).join(' ') + (year ? ` (${year})` : '');
    const qs = new URLSearchParams({ type, ...(genre && { genre }), ...(year && { year }), sort });
    const chipQs = new URLSearchParams({ type, ...(year && { year }), ...(sort !== 'popular' && { sort }) }).toString();
    res.render('site/discover', {
      title: heading, heading, isSearch: false, local: [], anime: [], ...result,
      type, types: DISCOVER_TYPES, media: 'anime', genres: anilist.GENRES.map(g => ({ id: g, name: g })), genre, year,
      language: '', languages: null, sort, sorts: ANIME_SORTS, qs: qs.toString(), chipQs
    });
  } catch (e) { aniDown(res, e); }
}

// CATEGORIES — every genre for movies, series and anime, plus languages
router.get('/categories', async (req, res) => {
  if (!tmdb.enabled()) return res.redirect('/browse');
  try {
    const [movie, tv] = await Promise.all([tmdb.genreList('movie'), tmdb.genreList('tv')]);
    const keep = list => list.filter(g => !SKIP_GENRES.has(g.name));
    const sections = [
      { name: 'Movies', all: '/discover?type=movie', items: keep(movie).map(g => ({ id: g.id, name: g.name, href: `/discover?type=movie&genre=${g.id}` })) },
      { name: 'Series', all: '/discover?type=tv', items: keep(tv).map(g => ({ id: g.id, name: g.name, href: `/discover?type=tv&genre=${g.id}` })) },
      { name: 'Anime', all: '/discover?type=anime', items: [
        { id: 7, name: 'Anime Movies', href: '/discover?type=anime-movie' },
        ...anilist.GENRES.map((g, i) => ({ id: 13 * (i + 3), name: g, href: `/discover?type=anime&genre=${encodeURIComponent(g)}` }))
      ] },
      { name: 'Movies by language', all: null, items: Object.entries(tmdb.LANGS).map(([code, name], i) => ({ id: 31 * (i + 1), name, href: `/discover?type=movie&language=${code}` })) }
    ];
    res.render('site/categories', { title: 'Categories', sections });
  } catch (e) { tmdbDown(res, e); }
});

// SEARCH — your CineBase titles first, then all of TMDB and AniList
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  const page = pageParam(req.query.page);
  if (!tmdb.enabled()) {
    // When TMDB is not enabled (local development without TMDB key), search local titles + live AniList
    const like = `%${q}%`;
    const local = page === 1
      ? await localCards(`SELECT ${CARD_COLS} FROM titles WHERE title LIKE ? OR director LIKE ? OR cast_members LIKE ? ORDER BY rating DESC LIMIT 24`, like, like, like)
      : [];
    const animeRes = await anilist.list({ search: q, perPage: 24, page }).catch(() => ({ items: [], page: 1, pages: 1, total: 0 }));
    return res.render('site/discover', {
      title: `Search: ${q}`, heading: `Results for "${q}"`, isSearch: true, local, anime: animeRes.items || [],
      items: [], page: animeRes.page || 1, pages: animeRes.pages || 1, total: (local.length + (animeRes.total || 0)),
      q, qs: new URLSearchParams({ q }).toString()
    });
  }
  try {
    const animePromise = page === 1
      ? Promise.race([
          anilist.list({ search: q, perPage: 12 }),
          new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2000))
        ]).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] });
    const [result, animeRes] = await Promise.all([
      tmdb.searchAll(q, page),
      animePromise
    ]);
    const like = `%${q}%`;
    const local = page === 1
      ? await localCards(`SELECT ${CARD_COLS} FROM titles WHERE title LIKE ? OR director LIKE ? OR cast_members LIKE ? ORDER BY rating DESC LIMIT 24`, like, like, like)
      : [];
    res.render('site/discover', {
      title: `Search: ${q}`, heading: `Results for "${q}"`, isSearch: true, local, anime: animeRes.items, ...result,
      q, qs: new URLSearchParams({ q }).toString()
    });
  } catch (e) { tmdbDown(res, e); }
});

// Live search suggestions for the header search box (JSON). Links open the title page at its player.
router.get('/suggest', async (req, res) => {
  const q = (req.query.q || '').trim();
  res.set('Cache-Control', 'private, max-age=300');
  if (q.length < 2) return res.json([]);
  if (!tmdb.enabled()) {
    try {
      const list = await anilist.list({ search: q, perPage: 6 });
      return res.json((list.items || []).map(i => ({
        title: i.title,
        year: i.release_year,
        type: i.type,
        poster: i.poster_url,
        href: `${i.href}#watch`
      })));
    } catch { return res.json([]); }
  }
  try {
    const { items } = await tmdb.searchAll(q.slice(0, 100), 1);
    res.json(items.slice(0, 8).map(i => ({
      title: i.title,
      year: i.release_year,
      type: i.type,
      poster: i.poster_url ? i.poster_url.replace('/w342/', '/w92/') : null,
      href: `${i.href}#watch`
    })));
  } catch (e) {
    console.error('TMDB suggest failed:', e.message);
    res.status(502).json([]);
  }
});

// BROWSE — your own CineBase catalogue
router.get('/browse', async (req, res) => {
  const where = [];
  const p = {};
  const q = (req.query.q || '').trim();
  if (q) { where.push('(title LIKE @q OR director LIKE @q OR cast_members LIKE @q)'); p.q = `%${q}%`; }
  if (['Movie', 'Series'].includes(req.query.type)) { where.push('type = @type'); p.type = req.query.type; }
  if (req.query.genre) { where.push('genre = @genre'); p.genre = req.query.genre; }
  if (req.query.language) { where.push('language = @language'); p.language = req.query.language; }
  if (req.query.source === 'plex') where.push('plex_rating_key IS NOT NULL');
  const sorts = { rating: 'rating DESC', new: 'id DESC', year: 'release_year DESC', title: 'title COLLATE NOCASE' };
  const sort = sorts[req.query.sort] ? req.query.sort : 'rating';
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await db.get(`SELECT COUNT(*) c FROM titles ${clause}`, p)).c;
  const pages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const items = (await db.all(`SELECT ${CARD_COLS} FROM titles ${clause} ORDER BY ${sorts[sort]}, id LIMIT @lim OFFSET @off`, { ...p, lim: BROWSE_PAGE_SIZE, off: (page - 1) * BROWSE_PAGE_SIZE }));
  const genres = (await db.all('SELECT DISTINCT genre FROM titles ORDER BY genre')).map(r => r.genre);
  const languages = (await db.all('SELECT DISTINCT language FROM titles ORDER BY language')).map(r => r.language);
  const heading = q ? `Results for "${q}"` : req.query.type === 'Movie' ? 'Movies' : req.query.type === 'Series' ? 'Series' : req.query.genre || (req.query.source === 'plex' ? 'On Your Plex' : 'Your CineBase');
  const qs = new URLSearchParams(req.query);
  qs.delete('page');
  res.render('site/browse', { title: heading, heading, items, total, page, pages, qs: qs.toString(), genres, languages, query: req.query, sort, q });
});

// WATCHLIST — active profile's saved titles
router.get('/watchlist', async (req, res) => {
  const profileId = req.session.activeProfileId;
  const items = profileId
    ? await db.all('SELECT * FROM watchlists WHERE profile_id = ? ORDER BY id DESC', profileId)
    : [];

  const mapped = items.map(w => ({
    id: w.media_id,
    title: w.title,
    poster_url: w.poster_url,
    href: w.href,
    release_year: w.release_year,
    rating: w.rating,
    type: w.media_type === 'movie' ? 'Movie' : (w.media_type === 'anime' ? 'Anime' : 'Series')
  }));

  res.render('site/browse', {
    title: 'My Watchlist',
    heading: 'My Watchlist',
    items: mapped,
    total: mapped.length,
    page: 1,
    pages: 1,
    qs: '',
    genres: [],
    languages: [],
    query: {},
    sort: 'new',
    q: '',
    showFilterbar: false,
    emptyMsg: 'Your watchlist is empty. Add titles to watch them later!'
  });
});

// WATCH HISTORY — active profile's playback progress
router.get('/history', async (req, res) => {
  const profileId = req.session.activeProfileId;
  const items = profileId
    ? await db.all('SELECT * FROM watch_history WHERE profile_id = ? ORDER BY updated_at DESC', profileId)
    : [];

  const mapped = items.map(h => ({
    id: h.media_id,
    title: h.title,
    poster_url: h.poster_url,
    href: h.href,
    season: h.season,
    episode: h.episode,
    progress_seconds: h.progress_seconds,
    duration_seconds: h.duration_seconds,
    type: h.media_type === 'movie' ? 'Movie' : (h.media_type === 'anime' ? 'Anime' : 'Series')
  }));

  res.render('site/browse', {
    title: 'Watch History',
    heading: 'Continue Watching',
    items: mapped,
    total: mapped.length,
    page: 1,
    pages: 1,
    qs: '',
    genres: [],
    languages: [],
    query: {},
    sort: 'new',
    q: '',
    showFilterbar: false,
    emptyMsg: 'Your watch history is empty. Start streaming to track your progress!'
  });
});

// Trailer for the hover preview on poster cards (JSON)
router.get('/preview/:media/:id', async (req, res) => {
  const { media, id } = req.params;
  if (!['movie', 'tv', 'anime'].includes(media) || !/^\d+$/.test(id) || (media !== 'anime' && !tmdb.enabled())) return res.status(404).json({ trailer: null });
  res.set('Cache-Control', 'private, max-age=21600');
  try {
    const trailer_key = media === 'anime' ? await anilist.trailer(id) : await tmdb.trailer(media, id);
    res.json({ trailer: /^[\w-]{11}$/.test(trailer_key) ? trailer_key : null });
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ trailer: null });
  }
});

// Episodes of an anime, 100 per tab (JSON)
router.get('/episodes/anime/:id/:chunk', async (req, res) => {
  const { id, chunk } = req.params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(chunk) || chunk === '0') return res.status(404).json([]);
  res.set('Cache-Control', 'private, max-age=3600');
  try { res.json(await anilist.episodes(id, Number(chunk))); }
  catch (e) { res.status(e.status === 404 ? 404 : 502).json([]); }
});

// Direct Movie/Series stream sources via P-Stream + Consumet auto-switching
router.get('/api/media/watch', async (req, res) => {
  const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
  const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
  const tmdbId = typeof req.query.tmdbId === 'string' ? req.query.tmdbId.trim() : '';
  const type = req.query.type === 'Series' || req.query.type === 'tv' ? 'Series' : 'Movie';
  const season = parseInt(req.query.season, 10) || 1;
  const episode = parseInt(req.query.episode, 10) || 1;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const data = await mediaStreams.getMediaStreams({ title, year, tmdbId, type, season, episode });
    res.set('Cache-Control', 'private, max-age=300');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'No direct stream found' });
  }
});

// Anime stream sources: Consumet (Server 1), P-Stream (Server 2), & Anivexa-API (Servers 3-12)
router.get('/api/anime/watch/:anilistId/:ep', async (req, res) => {
  const { anilistId, ep } = req.params;
  if (!/^\d+$/.test(anilistId) || !/^\d+$/.test(ep)) {
    return res.status(400).json({ error: 'Invalid anime ID or episode number' });
  }
  const audio = req.query.audio === 'dub' ? 'dub' : 'sub';
  const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
  let title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
  let year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
  const tmdbId = typeof req.query.tmdbId === 'string' ? req.query.tmdbId.trim() : '';
  if (!title) {
    try {
      const info = await anilist.titlePage(anilistId);
      title = info?.item?.title || '';
      year = year || String(info?.item?.release_year || '');
    } catch {}
  }
  try {
    const data = await anivexa.getWatchSources(anilistId, ep, audio, provider, { title, year, tmdbId });
    res.set('Cache-Control', 'private, max-age=300');
    res.json(data);
  } catch (e) {
    console.error('Anime watch error:', e.message);
    res.status(502).json({ error: e.message || 'Failed to load anime stream' });
  }
});

const FLIX_SEG_XOR = Uint8Array.from([157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197]);

function decryptFlixManifest(buf, playlistKey) {
  const trimmed = buf.toString('utf8').trim();
  if (trimmed.startsWith('#EXTM3U')) return trimmed;
  if (!playlistKey) return null;
  const key = Buffer.from(playlistKey, 'base64');
  const payload = Buffer.from(trimmed, 'base64');
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % key.length];
  const text = out.toString('utf8').trim();
  return text.startsWith('#EXTM3U') ? text : null;
}

function unwrapFlixSegment(body) {
  let offset = 0;
  let needsXor = false;
  if (body.length > 12 && body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46 &&
      body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) {
    offset = 12;
    needsXor = body[offset] !== 0x47;
  } else if (body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47 &&
             body[4] === 0x0d && body[5] === 0x0a && body[6] === 0x1a && body[7] === 0x0a) {
    offset = 8;
    needsXor = body[offset] !== 0x47;
  }
  if (!offset) return { body, unwrapped: false };
  const out = Buffer.from(body.subarray(offset));
  if (needsXor) {
    for (let i = 0; i < out.length; i++) out[i] ^= FLIX_SEG_XOR[i % FLIX_SEG_XOR.length];
  }
  return { body: out, unwrapped: true };
}

// Lightweight HLS / subtitle proxy to attach Referer headers, decrypt FlixCloud manifests, and bypass CORS
router.get('/api/anime/proxy', async (req, res) => {
  const targetUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const referer = typeof req.query.referer === 'string' ? req.query.referer.trim() : '';
  const playlistKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).send('Invalid URL');
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    if (referer) {
      headers['Referer'] = referer;
      try { headers['Origin'] = new URL(referer).origin; } catch {}
    }

    const upstream = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream error ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.set('Access-Control-Allow-Origin', '*');

    const buf = Buffer.from(await upstream.arrayBuffer());
    const looksM3u8 = targetUrl.includes('.m3u8') || /mpegurl/i.test(contentType) || buf.subarray(0, 16).toString('utf8').trimStart().startsWith('#EXTM3U');
    const decryptedText = (looksM3u8 || playlistKey) ? decryptFlixManifest(buf, playlistKey) : null;

    if (decryptedText) {
      const base = new URL(targetUrl);
      const wrap = u => {
        const abs = new URL(u, base).href;
        return `/api/anime/proxy?url=${encodeURIComponent(abs)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}${playlistKey ? `&key=${encodeURIComponent(playlistKey)}` : ''}`;
      };
      const rewritten = decryptedText
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${wrap(uri)}"`);
          }
          return wrap(trimmed);
        })
        .join('\n');
      res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.send(rewritten);
    }

    if (looksM3u8) {
      return res.status(502).send('Upstream did not return a valid M3U8 playlist');
    }

    const seg = unwrapFlixSegment(buf);
    res.set('Content-Type', seg.unwrapped ? 'video/mp2t' : contentType);
    return res.send(seg.body);
  } catch (e) {
    console.error('Anime proxy error:', e.message);
    return res.status(502).send('Proxy error');
  }
});

// DETAIL — an anime from AniList; plays via Vidy /anime/{anilistId}/{episode}
router.get('/a/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  let data;
  try { data = await anilist.titlePage(req.params.id); }
  catch (e) { return e.status === 404 ? next() : aniDown(res, e); }
  const player = vidsrc.player(data.item, { seasons: data.seasons, initialEpisodes: data.initialEpisodes });
  res.render('site/detail', {
    title: data.item.title, item: data.item, player, similar: data.similar, cast: data.cast, castTitle: 'Characters',
    related: data.related, source: { media: 'anime', localId: null }
  });
});

// Episodes of a season (JSON) for the series player
router.get('/episodes/:tvId/:season', async (req, res) => {
  const { tvId, season } = req.params;
  if (!tmdb.enabled() || !/^\d+$/.test(tvId) || !/^\d+$/.test(season)) return res.status(404).json([]);
  res.set('Cache-Control', 'private, max-age=3600');
  try {
    res.json(await tmdb.season(tvId, season));
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json([]);
  }
});

// DETAIL — a title in your CineBase
router.get('/t/:id', async (req, res, next) => {
  const item = (await db.get('SELECT * FROM titles WHERE id = ?', req.params.id));
  if (!item) return next();
  const similar = (await db.all(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? AND id != ? ORDER BY rating DESC LIMIT 12`, item.genre, item.id));
  // Titles linked to AniList or TMDB get the cast row and, for series, the full season/episode picker
  let seasons = null, cast = [], initialEpisodes = null;
  if (item.anilist_id) {
    try {
      const extra = await anilist.titlePage(item.anilist_id);
      seasons = extra.seasons;
      cast = extra.cast;
      initialEpisodes = extra.initialEpisodes;
      if (!item.poster_url && extra.item.poster_url) item.poster_url = extra.item.poster_url;
      if (!item.backdrop_url && extra.item.backdrop_url) item.backdrop_url = extra.item.backdrop_url;
      if (!item.episode_count && extra.item.episode_count) item.episode_count = extra.item.episode_count;
    } catch (e) { console.error('AniList extras failed:', e.message); }
  } else if (item.tmdb_id && tmdb.enabled()) {
    try {
      const extra = await tmdb.titlePage(item.type === 'Series' ? 'tv' : 'movie', item.tmdb_id);
      seasons = extra.seasons;
      cast = extra.cast;
    } catch (e) { console.error('TMDB extras failed:', e.message); }
  }
  const player = vidsrc.player(item, { seasons, tvId: item.anilist_id ? null : (seasons ? item.tmdb_id : null), initialEpisodes });
  res.render('site/detail', { title: item.title, item, player, similar, cast, source: null });
});

// DETAIL — any TMDB title (/m/:id for movies, /tv/:id for series)
async function tmdbTitle(req, res, next, media) {
  if (!tmdb.enabled() || !/^\d+$/.test(req.params.id)) return next();
  let data;
  try {
    data = await tmdb.titlePage(media, req.params.id);
  } catch (e) {
    return e.status === 404 ? next() : tmdbDown(res, e);
  }
  const t = data.item;
  // Same title already in CineBase? Link it (Plex button, admin shortcut)
  const local = (await db.get('SELECT id, plex_rating_key FROM titles WHERE tmdb_id = ? AND type = ?', t.tmdb_id, t.type))
    || (t.imdb_id ? (await db.get('SELECT id, plex_rating_key FROM titles WHERE imdb_id = ?', t.imdb_id)) : null);
  const blank = v => (v === '' ? null : v);
  const item = {
    ...t,
    id: local?.id ?? t.tmdb_id,
    imdb_id: blank(t.imdb_id),
    rating: blank(t.rating),
    seasons: blank(t.seasons),
    duration_min: blank(t.duration_min),
    plex_rating_key: local?.plex_rating_key || null
  };
  const player = vidsrc.player(item, { seasons: data.seasons, tvId: media === 'tv' ? t.tmdb_id : null });
  let animeHref = null;
  if (data.isAnime) {
    try { const aid = await anilist.match(t.title, t.release_year); if (aid) animeHref = `/a/${aid}#watch`; }
    catch (e) { console.error('AniList match failed:', e.message); }
  }
  res.render('site/detail', {
    title: item.title, item, player, similar: data.similar, cast: data.cast, animeHref,
    source: { media, tmdbId: t.tmdb_id, localId: local?.id || null }
  });
}
router.get('/m/:id', async (req, res, next) => tmdbTitle(req, res, next, 'movie'));
router.get('/tv/:id', async (req, res, next) => tmdbTitle(req, res, next, 'tv'));

// Open on Plex
router.get('/t/:id/plex', async (req, res, next) => {
  const item = (await db.get('SELECT plex_rating_key FROM titles WHERE id = ?', req.params.id));
  if (!item?.plex_rating_key || !plex.enabled()) return next();
  try { res.redirect(await plex.watchUrl(item.plex_rating_key)); }
  catch (e) { res.status(502).render('error', { title: 'Plex unavailable', message: 'Could not reach the Plex server right now.' }); }
});

// Plex artwork proxy (keeps PLEX_TOKEN server-side)
router.get('/media/plex-art', async (req, res) => {
  if (!plex.enabled()) return res.sendStatus(404);
  try {
    const r = await plex.art(String(req.query.path || ''));
    if (!r.ok) return res.sendStatus(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.sendStatus(404);
  }
});

module.exports = router;
