const express = require('express');
const db = require('../db');
const { setFlash } = require('../middleware/auth');
const tmdb = require('../services/tmdb');

const router = express.Router();

const TYPES = ['Movie', 'Series'];
const STATUSES = ['Released', 'Ongoing', 'Upcoming', 'Ended'];
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'];
const SORTS = {
  newest: 'release_year DESC, title ASC',
  oldest: 'release_year ASC, title ASC',
  rating: 'rating DESC, title ASC',
  title: 'title COLLATE NOCASE ASC',
  updated: 'updated_at DESC, id DESC'
};
const PAGE_SIZE = 10;

const options = () => ({
  TYPES, STATUSES, GENRES, tmdbEnabled: tmdb.enabled(),
  languages: db.prepare('SELECT DISTINCT language FROM titles ORDER BY language').all().map(r => r.language)
});

function buildQuery(q) {
  const where = [];
  const params = {};
  if (q.q) {
    where.push('(title LIKE @q OR director LIKE @q OR cast_members LIKE @q OR synopsis LIKE @q)');
    params.q = `%${q.q}%`;
  }
  if (TYPES.includes(q.type)) { where.push('type = @type'); params.type = q.type; }
  if (q.genre) { where.push('genre = @genre'); params.genre = q.genre; }
  if (q.language) { where.push('language = @language'); params.language = q.language; }
  if (STATUSES.includes(q.status)) { where.push('status = @status'); params.status = q.status; }
  if (q.year_from) { where.push('release_year >= @yf'); params.yf = parseInt(q.year_from, 10) || 0; }
  if (q.year_to) { where.push('release_year <= @yt'); params.yt = parseInt(q.year_to, 10) || 9999; }
  if (q.min_rating) { where.push('rating >= @mr'); params.mr = parseFloat(q.min_rating) || 0; }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Accepts a YouTube URL or bare 11-char id
function youtubeId(v) {
  v = (v || '').trim();
  if (!v) return null;
  if (/^[\w-]{11}$/.test(v)) return v;
  const m = v.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function validate(body) {
  const errors = [];
  const t = {
    title: (body.title || '').trim(),
    type: body.type,
    genre: (body.genre || '').trim(),
    language: (body.language || '').trim(),
    release_year: parseInt(body.release_year, 10),
    director: (body.director || '').trim() || null,
    cast_members: (body.cast_members || '').trim() || null,
    seasons: body.seasons === '' || body.seasons == null ? null : parseInt(body.seasons, 10),
    duration_min: body.duration_min === '' || body.duration_min == null ? null : parseInt(body.duration_min, 10),
    rating: body.rating === '' || body.rating == null ? null : parseFloat(body.rating),
    platform: (body.platform || '').trim() || null,
    status: body.status,
    synopsis: (body.synopsis || '').trim() || null,
    poster_url: (body.poster_url || '').trim() || null,
    backdrop_url: (body.backdrop_url || '').trim() || null,
    trailer_key: youtubeId(body.trailer_key),
    tmdb_id: body.tmdb_id ? parseInt(body.tmdb_id, 10) || null : null
  };
  const year = new Date().getFullYear();
  if (!t.title) errors.push('Title is required.');
  if (!TYPES.includes(t.type)) errors.push('Type must be Movie or Series.');
  if (!t.genre) errors.push('Genre is required.');
  if (!t.language) errors.push('Language is required.');
  if (!Number.isInteger(t.release_year) || t.release_year < 1888 || t.release_year > year + 5)
    errors.push(`Release year must be between 1888 and ${year + 5}.`);
  if (t.rating !== null && (isNaN(t.rating) || t.rating < 0 || t.rating > 10)) errors.push('Rating must be between 0 and 10.');
  if (t.seasons !== null && (isNaN(t.seasons) || t.seasons < 1)) errors.push('Seasons must be a positive number.');
  if (t.duration_min !== null && (isNaN(t.duration_min) || t.duration_min < 1)) errors.push('Duration must be a positive number.');
  if (!STATUSES.includes(t.status)) errors.push('Invalid status.');
  for (const f of ['poster_url', 'backdrop_url'])
    if (t[f] && !/^(https?:\/\/|\/media\/plex-art\?)/.test(t[f])) errors.push(`${f.replace('_', ' ')} must be an http(s) URL.`);
  if (body.trailer_key && !t.trailer_key) errors.push('Trailer must be a YouTube link or video ID.');
  if (t.type === 'Movie') t.seasons = null;
  return { t, errors };
}

// LIST + SEARCH
router.get('/', (req, res) => {
  const { clause, params } = buildQuery(req.query);
  const sort = SORTS[req.query.sort] ? req.query.sort : 'updated';
  const total = db.prepare(`SELECT COUNT(*) c FROM titles ${clause}`).get(params).c;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const rows = db.prepare(`SELECT * FROM titles ${clause} ORDER BY ${SORTS[sort]} LIMIT @lim OFFSET @off`)
    .all({ ...params, lim: PAGE_SIZE, off: (page - 1) * PAGE_SIZE });

  const qs = new URLSearchParams({ ...req.query });
  qs.delete('page');
  res.render('titles/index', { title: 'Movies & Series', rows, total, page, pages, query: req.query, sort, qs: qs.toString(), ...options() });
});

// EXPORT current search as CSV (opens in Excel)
router.get('/export.csv', (req, res) => {
  const { clause, params } = buildQuery(req.query);
  const rows = db.prepare(`SELECT * FROM titles ${clause} ORDER BY title`).all(params);
  const cols = ['id', 'title', 'type', 'genre', 'language', 'release_year', 'director', 'cast_members', 'seasons', 'duration_min', 'rating', 'platform', 'status', 'synopsis'];
  const esc = v => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cinebase-titles.csv"');
  res.send(csv);
});

// TMDB lookup (JSON, used by the add/edit form)
router.get('/tmdb/search', async (req, res) => {
  if (!tmdb.enabled()) return res.status(400).json({ error: 'TMDB_API_KEY is not set on the server.' });
  try { res.json(await tmdb.search(String(req.query.q || ''), req.query.year)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/tmdb/:media/:id', async (req, res) => {
  if (!['movie', 'tv'].includes(req.params.media)) return res.status(400).json({ error: 'media must be movie or tv' });
  if (!tmdb.enabled()) return res.status(400).json({ error: 'TMDB_API_KEY is not set on the server.' });
  try { res.json(await tmdb.details(req.params.media, req.params.id)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Fill missing posters/trailers for every title from TMDB
router.post('/tmdb/enrich', async (req, res) => {
  if (!tmdb.enabled()) { setFlash(req, 'error', 'Set TMDB_API_KEY first.'); return res.redirect('/titles'); }
  const rows = db.prepare('SELECT id,title,type,release_year,tmdb_id FROM titles WHERE poster_url IS NULL OR backdrop_url IS NULL OR trailer_key IS NULL').all();
  const upd = db.prepare(`UPDATE titles SET tmdb_id=COALESCE(tmdb_id,@tmdb_id), poster_url=COALESCE(poster_url,NULLIF(@poster_url,'')),
    backdrop_url=COALESCE(backdrop_url,NULLIF(@backdrop_url,'')), trailer_key=COALESCE(trailer_key,NULLIF(@trailer_key,'')),
    cast_members=COALESCE(cast_members,NULLIF(@cast_members,'')), synopsis=COALESCE(synopsis,NULLIF(@synopsis,'')),
    updated_at=datetime('now') WHERE id=@id`);
  let done = 0, missed = 0;
  for (const r of rows) {
    try {
      const media = r.type === 'Series' ? 'tv' : 'movie';
      let id = r.tmdb_id;
      if (!id) {
        const hits = (await tmdb.search(r.title, r.release_year)).filter(h => h.media === media);
        id = hits[0]?.tmdb_id;
      }
      if (!id) { missed++; continue; }
      const d = await tmdb.details(media, id);
      upd.run({ id: r.id, tmdb_id: d.tmdb_id, poster_url: d.poster_url, backdrop_url: d.backdrop_url, trailer_key: d.trailer_key, cast_members: d.cast_members, synopsis: d.synopsis });
      done++;
    } catch { missed++; }
  }
  setFlash(req, missed ? 'error' : 'success', `TMDB: updated ${done} title(s)${missed ? `, ${missed} not matched` : ''}.`);
  res.redirect('/titles');
});

// ADD
router.get('/new', (req, res) => {
  res.render('titles/form', { title: 'Add Title', item: { type: 'Movie', status: 'Released' }, errors: [], action: '/titles', method: 'POST', ...options() });
});

router.post('/', (req, res) => {
  const { t, errors } = validate(req.body);
  if (errors.length) return res.status(422).render('titles/form', { title: 'Add Title', item: req.body, errors, action: '/titles', method: 'POST', ...options() });
  const info = db.prepare(`INSERT INTO titles (title,type,genre,language,release_year,director,cast_members,seasons,duration_min,rating,platform,status,synopsis,poster_url,backdrop_url,trailer_key,tmdb_id)
    VALUES (@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@platform,@status,@synopsis,@poster_url,@backdrop_url,@trailer_key,@tmdb_id)`).run(t);
  setFlash(req, 'success', `"${t.title}" added.`);
  res.redirect(`/titles/${info.lastInsertRowid}`);
});

// VIEW
router.get('/:id', (req, res, next) => {
  const item = db.prepare('SELECT * FROM titles WHERE id = ?').get(req.params.id);
  if (!item) return next();
  res.render('titles/show', { title: item.title, item });
});

// MODIFY
router.get('/:id/edit', (req, res, next) => {
  const item = db.prepare('SELECT * FROM titles WHERE id = ?').get(req.params.id);
  if (!item) return next();
  res.render('titles/form', { title: 'Edit Title', item, errors: [], action: `/titles/${item.id}?_method=PUT`, method: 'PUT', ...options() });
});

router.put('/:id', (req, res, next) => {
  const exists = db.prepare('SELECT id FROM titles WHERE id = ?').get(req.params.id);
  if (!exists) return next();
  const { t, errors } = validate(req.body);
  if (errors.length) {
    return res.status(422).render('titles/form', { title: 'Edit Title', item: { ...req.body, id: exists.id }, errors, action: `/titles/${exists.id}?_method=PUT`, method: 'PUT', ...options() });
  }
  db.prepare(`UPDATE titles SET title=@title,type=@type,genre=@genre,language=@language,release_year=@release_year,director=@director,
    cast_members=@cast_members,seasons=@seasons,duration_min=@duration_min,rating=@rating,platform=@platform,status=@status,synopsis=@synopsis,
    poster_url=@poster_url,backdrop_url=@backdrop_url,trailer_key=@trailer_key,tmdb_id=@tmdb_id,
    updated_at=datetime('now') WHERE id=@id`).run({ ...t, id: exists.id });
  setFlash(req, 'success', `"${t.title}" updated.`);
  res.redirect(`/titles/${exists.id}`);
});

// DELETE
router.delete('/:id', (req, res) => {
  const item = db.prepare('SELECT title FROM titles WHERE id = ?').get(req.params.id);
  if (item) {
    db.prepare('DELETE FROM titles WHERE id = ?').run(req.params.id);
    setFlash(req, 'success', `"${item.title}" deleted.`);
  }
  res.redirect('/titles');
});

module.exports = router;
