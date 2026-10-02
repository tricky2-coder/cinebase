const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/admin', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null, username: '' });
});

router.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  const ok = row && row.role === 'admin' && bcrypt.compareSync(password, row.password);
  if (!ok) {
    // Stay on login page and show the message
    return res.status(401).render('login', { title: 'Login', error: 'Wrong credentials', username });
  }

  req.session.regenerate(err => {
    if (err) throw err;
    req.session.user = { id: row.id, name: row.name, username: row.username, role: row.role };
    req.session.flash = { type: 'success', msg: `Welcome back, ${row.name}!` };
    res.redirect('/dashboard');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
