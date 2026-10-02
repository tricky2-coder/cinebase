// Public, read-only catalogue frontend
const express = require('express');
const db = require('../db');
const plex = require('../services/plex');

const router = express.Router();
const CARD_COLS = 'id,title,type,genre,release_year,rating,poster_url,plex_rating_key';

router.use((req, res, next) => {
  res.locals.plexEnabled = plex.enabled();
  res.locals.q = '';
  res.locals.query = req.query;
  next();
});

// HOME
router.get('/', (req, res) => {
  const hero = db.prepare(`SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND rating IS NOT NULL ORDER BY rating DESC LIMIT 5`).all();
  const heroFallback = hero.length ? hero : db.prepare('SELECT * FROM titles ORDER BY rating DESC LIMIT 5').all();
  const rows = [
    { name: 'Recently Added', link: '/browse?sort=new', items: db.prepare(`SELECT ${CARD_COLS} FROM titles ORDER BY id DESC LIMIT 20`).all() },
    { name: 'Top Rated', link: '/browse?sort=rating', items: db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 20`).all() },
    { name: 'On Your Plex', link: '/browse?source=plex', items: db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE plex_rating_key IS NOT NULL ORDER BY updated_at DESC LIMIT 20`).all() },
    { name: 'Movies', link: '/browse?type=Movie', items: db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE type='Movie' ORDER BY release_year DESC LIMIT 20`).all() },
    { name: 'Series', link: '/browse?type=Series', items: db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE type='Series' ORDER BY release_year DESC LIMIT 20`).all() }
  ];
  const genres = db.prepare('SELECT genre, COUNT(*) c FROM titles GROUP BY genre HAVING c >= 2 ORDER BY c DESC LIMIT 6').all();
  for (const g of genres) {
    rows.push({ name: g.genre, link: `/browse?genre=${encodeURIComponent(g.genre)}`, items: db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? ORDER BY rating DESC LIMIT 20`).all(g.genre) });
  }
  res.render('site/home', { title: 'Home', hero: heroFallback, rows: rows.filter(r => r.items.length) });
});

// BROWSE / SEARCH
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
  const items = db.prepare(`SELECT ${CARD_COLS} FROM titles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sorts[sort]} LIMIT 200`).all(p);
  const genres = db.prepare('SELECT DISTINCT genre FROM titles ORDER BY genre').all().map(r => r.genre);
  const languages = db.prepare('SELECT DISTINCT language FROM titles ORDER BY language').all().map(r => r.language);
  const heading = q ? `Results for "${q}"` : req.query.type === 'Movie' ? 'Movies' : req.query.type === 'Series' ? 'Series' : req.query.genre || (req.query.source === 'plex' ? 'On Your Plex' : 'Browse');
  res.render('site/browse', { title: heading, heading, items, genres, languages, query: req.query, sort, q });
});

// DETAIL
router.get('/t/:id', (req, res, next) => {
  const item = db.prepare('SELECT * FROM titles WHERE id = ?').get(req.params.id);
  if (!item) return next();

  let embedUrl = null;
  const isSeries = item.type === 'Series' || item.type === 'tv';
  const mediaType = isSeries ? 'tv' : 'movie';

  // Using vidsrc.pm mirror
  if (item.imdb_id) {
    embedUrl = `https://vidsrc.pm/embed/${mediaType}/${item.imdb_id}${isSeries ? '?season=1&episode=1' : ''}`;
  } else if (item.tmdb_id) {
    embedUrl = `https://vidsrc.pm/embed/${mediaType}/${item.tmdb_id}${isSeries ? '?season=1&episode=1' : ''}`;
  }

  const similar = db.prepare(`SELECT ${CARD_COLS} FROM titles WHERE genre = ? AND id != ? ORDER BY rating DESC LIMIT 12`).all(item.genre, item.id);
  res.render('site/detail', { title: item.title, item, embedUrl, similar });
});

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