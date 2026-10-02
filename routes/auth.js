const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Compared against when the username doesn't exist, so response time doesn't reveal valid usernames
const DUMMY_HASH = bcrypt.hashSync('cinebase-dummy-password', 10);

// 10 failed attempts per IP per 15 minutes; successful logins (redirects) don't count
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('login', {
    title: 'Login',
    error: 'Too many failed attempts. Try again in 15 minutes.',
    username: (req.body.username || '').trim()
  })
});

router.get('/admin', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null, username: '' });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  const passwordOk = bcrypt.compareSync(password, row ? row.password : DUMMY_HASH);
  if (!row || row.role !== 'admin' || !passwordOk) {
    // Stay on login page and show the message
    return res.status(401).render('login', { title: 'Login', error: 'Wrong credentials', username });
  }

  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = { id: row.id, name: row.name, username: row.username, role: row.role };
    req.session.flash = { type: 'success', msg: `Welcome back, ${row.name}!` };
    res.redirect('/dashboard');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
