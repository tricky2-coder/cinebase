// Public, read-only frontend: live TMDB catalogue (when TMDB_API_KEY is set) plus your own CineBase titles
const express = require('express');
const db = require('../db');
const plex = require('../services/plex');
const tmdb = require('../services/tmdb');
const vidsrc = require('../services/vidsrc');

const router = express.Router();
const CARD_COLS = 'id,title,type,genre,release_year,rating,poster_url,backdrop_url,trailer_key,tmdb_id,plex_rating_key';
const BROWSE_PAGE_SIZE = 24;
const DISCOVER_SORTS = { popular: 'Most popular', rating: 'Top rated', newest: 'Newest' };
// What /discover?type= can show. Anime = TMDB titles tagged "anime".
const DISCOVER_TYPES = {
  movie: { media: 'movie', label: 'Movies' },
  tv: { media: 'tv', label: 'Series' },
  anime: { media: 'tv', label: 'Anime', keywords: tmdb.ANIME_KEYWORD },
  'anime-movie': { media: 'movie', label: 'Anime Movies', keywords: tmdb.ANIME_KEYWORD }
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

const tmdbDown = (res, e) => {
  console.error('TMDB request failed:', e.message);
  res.status(502).render('error', { title: 'TMDB unavailable', message: 'Could not load titles from TMDB right now. Please try again.' });
};
const pageParam = (v, max = 500) => Math.min(Math.max(1, parseInt(v, 10) || 1), max);
const withHref = rows => rows.map(r => ({ ...r, href: `/t/${r.id}` }));
const localCards = (sql, ...args) => db.prepare(sql).all(...args);

// HOME
router.get('/', async (req, res) => {
  let hero = [];
  let rows = [];
  if (tmdb.enabled()) {
    const A = tmdb.ANIME_KEYWORD;
    const specs = [
      ['Trending This Week', null, () => tmdb.trending()],
      ['Popular Movies', '/discover?type=movie', () => tmdb.popular('movie')],
      ['Popular Series', '/discover?type=tv', () => tmdb.popular('tv')],
      ['Popular Anime', '/discover?type=anime', () => tmdb.discover('tv', { keywords: A })],
      ['Top Rated Movies', '/discover?type=movie&sort=rating', () => tmdb.topRated('movie')],
      ['Top Rated Series', '/discover?type=tv&sort=rating', () => tmdb.topRated('tv')],
      ['Action Movies', '/discover?type=movie&genre=28', () => tmdb.discover('movie', { genre: 28 })],
      ['Hindi Movies', '/discover?type=movie&language=hi', () => tmdb.discover('movie', { language: 'hi' })],
      ['Comedy Movies', '/discover?type=movie&genre=35', () => tmdb.discover('movie', { genre: 35 })],
      ['Anime Movies', '/discover?type=anime-movie', () => tmdb.discover('movie', { keywords: A })],
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
      { name: 'Your CineBase', link: '/browse?sort=new', items: localCards(`SELECT ${CARD_COLS} FROM titles ORDER BY id DESC LIMIT 20`) },
      { name: 'On Your Plex', link: '/browse?source=plex', items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE plex_rating_key IS NOT NULL ORDER BY updated_at DESC LIMIT 20`) }
    );
  } else {
    const localHero = db.prepare('SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND rating IS NOT NULL ORDER BY rating DESC LIMIT 5').all();
    hero = withHref(localHero.length ? localHero : db.prepare('SELECT * FROM titles ORDER BY rating DESC LIMIT 5').all());
    rows = [
      { name: 'Recently Added', link: '/browse?sort=new', items: localCards(`SELECT ${CARD_COLS} FROM titles ORDER BY id DESC LIMIT 20`) },
      { name: 'Top Rated', link: '/browse?sort=rating', items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 20`) },
      { name: 'On Your Plex', link: '/browse?source=plex', items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE plex_rating_key IS NOT NULL ORDER BY updated_at DESC LIMIT 20`) },
      { name: 'Movies', link: '/browse?type=Movie', items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE type='Movie' ORDER BY release_year DESC LIMIT 20`) },
      { name: 'Series', link: '/browse?type=Series', items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE type='Series' ORDER BY release_year DESC LIMIT 20`) }
    ];
    const genres = db.prepare('SELECT genre, COUNT(*) c FROM titles GROUP BY genre HAVING c >= 2 ORDER BY c DESC LIMIT 6').all();
    for (const g of genres) {
      rows.push({ name: g.genre, link: `/browse?genre=${encodeURIComponent(g.genre)}`, items: localCards(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? ORDER BY rating DESC LIMIT 20`, g.genre) });
    }
  }
  res.render('site/home', { title: 'Home', hero, rows: rows.filter(r => r.items.length) });
});

// DISCOVER — the full TMDB catalogue with filters
router.get('/discover', async (req, res) => {
  if (!tmdb.enabled()) return res.redirect('/browse');
  const type = DISCOVER_TYPES[req.query.type] ? req.query.type : 'movie';
  const { media, label, keywords } = DISCOVER_TYPES[type];
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
      title: heading, heading, isSearch: false, local: [], ...result,
      type, types: DISCOVER_TYPES, media, genres, genre: genre ? String(genre.id) : '', year, language, sort,
      sorts: DISCOVER_SORTS, languages: tmdb.LANGS, qs: qs.toString(), chipQs
    });
  } catch (e) { tmdbDown(res, e); }
});

// CATEGORIES — every genre for movies, series and anime, plus languages
router.get('/categories', async (req, res) => {
  if (!tmdb.enabled()) return res.redirect('/browse');
  try {
    const [movie, tv] = await Promise.all([tmdb.genreList('movie'), tmdb.genreList('tv')]);
    const keep = list => list.filter(g => !SKIP_GENRES.has(g.name));
    const animeGenres = keep(tv).filter(g => !['Animation', 'Documentary', 'Western', 'War & Politics'].includes(g.name));
    const sections = [
      { name: 'Movies', all: '/discover?type=movie', items: keep(movie).map(g => ({ id: g.id, name: g.name, href: `/discover?type=movie&genre=${g.id}` })) },
      { name: 'Series', all: '/discover?type=tv', items: keep(tv).map(g => ({ id: g.id, name: g.name, href: `/discover?type=tv&genre=${g.id}` })) },
      { name: 'Anime', all: '/discover?type=anime', items: [
        { id: 7, name: 'Anime Movies', href: '/discover?type=anime-movie' },
        ...animeGenres.map(g => ({ id: g.id, name: g.name, href: `/discover?type=anime&genre=${g.id}` }))
      ] },
      { name: 'Movies by language', all: null, items: Object.entries(tmdb.LANGS).map(([code, name], i) => ({ id: 31 * (i + 1), name, href: `/discover?type=movie&language=${code}` })) }
    ];
    res.render('site/categories', { title: 'Categories', sections });
  } catch (e) { tmdbDown(res, e); }
});

// SEARCH — your CineBase titles first, then all of TMDB
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  if (!tmdb.enabled()) return res.redirect(`/browse?q=${encodeURIComponent(q)}`);
  const page = pageParam(req.query.page);
  try {
    const result = await tmdb.searchAll(q, page);
    const like = `%${q}%`;
    const local = page === 1
      ? localCards(`SELECT ${CARD_COLS} FROM titles WHERE title LIKE ? OR director LIKE ? OR cast_members LIKE ? ORDER BY rating DESC LIMIT 24`, like, like, like)
      : [];
    res.render('site/discover', {
      title: `Search: ${q}`, heading: `Results for "${q}"`, isSearch: true, local, ...result,
      q, qs: new URLSearchParams({ q }).toString()
    });
  } catch (e) { tmdbDown(res, e); }
});

// Live search suggestions for the header search box (JSON). Links open the title page at its player.
router.get('/suggest', async (req, res) => {
  const q = (req.query.q || '').trim();
  res.set('Cache-Control', 'private, max-age=300');
  if (!tmdb.enabled() || q.length < 2) return res.json([]);
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
router.get('/browse', (req, res) => {
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
  const total = db.prepare(`SELECT COUNT(*) c FROM titles ${clause}`).get(p).c;
  const pages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const items = db.prepare(`SELECT ${CARD_COLS} FROM titles ${clause} ORDER BY ${sorts[sort]}, id LIMIT @lim OFFSET @off`)
    .all({ ...p, lim: BROWSE_PAGE_SIZE, off: (page - 1) * BROWSE_PAGE_SIZE });
  const genres = db.prepare('SELECT DISTINCT genre FROM titles ORDER BY genre').all().map(r => r.genre);
  const languages = db.prepare('SELECT DISTINCT language FROM titles ORDER BY language').all().map(r => r.language);
  const heading = q ? `Results for "${q}"` : req.query.type === 'Movie' ? 'Movies' : req.query.type === 'Series' ? 'Series' : req.query.genre || (req.query.source === 'plex' ? 'On Your Plex' : 'Your CineBase');
  const qs = new URLSearchParams(req.query);
  qs.delete('page');
  res.render('site/browse', { title: heading, heading, items, total, page, pages, qs: qs.toString(), genres, languages, query: req.query, sort, q });
});

// Trailer for the hover preview on poster cards (JSON)
router.get('/preview/:media/:id', async (req, res) => {
  const { media, id } = req.params;
  if (!tmdb.enabled() || !['movie', 'tv'].includes(media) || !/^\d+$/.test(id)) return res.status(404).json({ trailer: null });
  res.set('Cache-Control', 'private, max-age=21600');
  try {
    const { trailer_key } = await tmdb.details(media, id);
    res.json({ trailer: /^[\w-]{11}$/.test(trailer_key) ? trailer_key : null });
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ trailer: null });
  }
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
  const item = db.prepare('SELECT * FROM titles WHERE id = ?').get(req.params.id);
  if (!item) return next();
  const similar = db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? AND id != ? ORDER BY rating DESC LIMIT 12`).all(item.genre, item.id);
  // Titles linked to TMDB get the cast row and, for series, the full season/episode picker
  let seasons = null, cast = [];
  if (item.tmdb_id && tmdb.enabled()) {
    try {
      const extra = await tmdb.titlePage(item.type === 'Series' ? 'tv' : 'movie', item.tmdb_id);
      seasons = extra.seasons;
      cast = extra.cast;
    } catch (e) { console.error('TMDB extras failed:', e.message); }
  }
  const player = vidsrc.player(item, { seasons, tvId: seasons ? item.tmdb_id : null });
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
  const local = db.prepare('SELECT id, plex_rating_key FROM titles WHERE tmdb_id = ? AND type = ?').get(t.tmdb_id, t.type)
    || (t.imdb_id ? db.prepare('SELECT id, plex_rating_key FROM titles WHERE imdb_id = ?').get(t.imdb_id) : null);
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
  res.render('site/detail', {
    title: item.title, item, player, similar: data.similar, cast: data.cast,
    source: { media, tmdbId: t.tmdb_id, localId: local?.id || null }
  });
}
router.get('/m/:id', (req, res, next) => tmdbTitle(req, res, next, 'movie'));
router.get('/tv/:id', (req, res, next) => tmdbTitle(req, res, next, 'tv'));

// Open on Plex
router.get('/t/:id/plex', async (req, res, next) => {
  const item = db.prepare('SELECT plex_rating_key FROM titles WHERE id = ?').get(req.params.id);
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
