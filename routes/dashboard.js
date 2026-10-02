const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const stats = {
    total:    db.prepare('SELECT COUNT(*) c FROM titles').get().c,
    movies:   db.prepare("SELECT COUNT(*) c FROM titles WHERE type='Movie'").get().c,
    series:   db.prepare("SELECT COUNT(*) c FROM titles WHERE type='Series'").get().c,
    users:    db.prepare('SELECT COUNT(*) c FROM users').get().c,
    avgRating: db.prepare('SELECT ROUND(AVG(rating),1) a FROM titles').get().a || 0
  };
  const byGenre = db.prepare('SELECT genre, COUNT(*) c FROM titles GROUP BY genre ORDER BY c DESC').all();
  const recent = db.prepare('SELECT * FROM titles ORDER BY updated_at DESC, id DESC LIMIT 5').all();
  const topRated = db.prepare('SELECT * FROM titles WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 5').all();
  res.render('dashboard', { title: 'Dashboard', stats, byGenre, recent, topRated });
});

module.exports = router;
