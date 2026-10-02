const express = require('express');
const db = require('../db');
const { setFlash } = require('../middleware/auth');

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
  TYPES, STATUSES, GENRES,
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
    synopsis: (body.synopsis || '').trim() || null
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

// ADD
router.get('/new', (req, res) => {
  res.render('titles/form', { title: 'Add Title', item: { type: 'Movie', status: 'Released' }, errors: [], action: '/titles', method: 'POST', ...options() });
});

router.post('/', (req, res) => {
  const { t, errors } = validate(req.body);
  if (errors.length) return res.status(422).render('titles/form', { title: 'Add Title', item: req.body, errors, action: '/titles', method: 'POST', ...options() });
  const info = db.prepare(`INSERT INTO titles (title,type,genre,language,release_year,director,cast_members,seasons,duration_min,rating,platform,status,synopsis)
    VALUES (@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@platform,@status,@synopsis)`).run(t);
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
