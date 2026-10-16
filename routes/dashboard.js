const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const stats = {
    total:    (await db.get('SELECT COUNT(*) c FROM titles')).c,
    movies:   (await db.get("SELECT COUNT(*) c FROM titles WHERE type='Movie'")).c,
    series:   (await db.get("SELECT COUNT(*) c FROM titles WHERE type='Series'")).c,
    users:    (await db.get('SELECT COUNT(*) c FROM users')).c,
    avgRating: (await db.get('SELECT ROUND(AVG(rating),1) a FROM titles')).a || 0
  };
  const byGenre = (await db.all('SELECT genre, COUNT(*) c FROM titles GROUP BY genre ORDER BY c DESC'));
  const recent = (await db.all('SELECT * FROM titles ORDER BY updated_at DESC, id DESC LIMIT 5'));
  const topRated = (await db.all('SELECT * FROM titles WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 5'));
  res.render('dashboard', { title: 'Dashboard', stats, byGenre, recent, topRated });
});

module.exports = router;
