const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const { safeNext } = require('../middleware/auth');

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
    title: 'Sign in',
    error: 'Too many failed attempts. Try again in 15 minutes.',
    username: (req.body.username || '').trim(),
    next: safeNext(req.body.next)
  })
});

// Where each role lands after signing in
const homeFor = user => (user.role === 'admin' ? '/dashboard' : '/');

router.get('/admin', (req, res) => res.redirect(req.session.user ? homeFor(req.session.user) : '/login'));

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user));
  res.render('login', { title: 'Sign in', error: null, username: '', next: safeNext(req.query.next) });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const target = safeNext(req.body.next);
  // Usernames are stored lowercase by the Users form; the seeded admin keeps ADMIN_USERNAME's casing
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);

  const passwordOk = bcrypt.compareSync(password, row ? row.password : DUMMY_HASH);
  if (!row || !passwordOk) {
    // Stay on login page and show the message
    return res.status(401).render('login', { title: 'Sign in', error: 'Wrong credentials', username, next: target });
  }

  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = { id: row.id, name: row.name, username: row.username, role: row.role };
    if (row.role === 'admin') req.session.flash = { type: 'success', msg: `Welcome back, ${row.name}!` };
    // Users can't open admin pages, so ignore an admin "next" for them
    const dest = target && (row.role === 'admin' || !/^\/(dashboard|titles|users|plex)\b/.test(target)) ? target : homeFor(row);
    res.redirect(dest);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
