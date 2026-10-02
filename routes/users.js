const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { setFlash } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['admin', 'user'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body, { id = null, requirePassword }) {
  const errors = [];
  const u = {
    name: (body.name || '').trim(),
    username: (body.username || '').trim().toLowerCase(),
    email: (body.email || '').trim().toLowerCase(),
    role: body.role,
    password: body.password || ''
  };
  if (!u.name) errors.push('Name is required.');
  if (!/^[a-z0-9_.]{3,30}$/.test(u.username)) errors.push('Username must be 3–30 chars: letters, numbers, _ or .');
  if (!EMAIL_RE.test(u.email)) errors.push('Enter a valid email.');
  if (!ROLES.includes(u.role)) errors.push('Invalid role.');
  if (requirePassword || u.password) {
    if (u.password.length < 6) errors.push('Password must be at least 6 characters.');
    if (u.password !== body.confirm_password) errors.push('Passwords do not match.');
  }
  const dupe = db.prepare('SELECT username, email FROM users WHERE (username = ? OR email = ?) AND id IS NOT ?').get(u.username, u.email, id);
  if (dupe) errors.push(dupe.username === u.username ? 'Username already taken.' : 'Email already in use.');
  return { u, errors };
}

const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;

// LIST + SEARCH
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const role = ROLES.includes(req.query.role) ? req.query.role : '';
  const where = [];
  const params = {};
  if (q) { where.push('(name LIKE @q OR username LIKE @q OR email LIKE @q)'); params.q = `%${q}%`; }
  if (role) { where.push('role = @role'); params.role = role; }
  const rows = db.prepare(`SELECT id,name,username,email,role,created_at FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`).all(params);
  res.render('users/index', { title: 'Users', rows, q, role, ROLES });
});

// ADD
router.get('/new', (req, res) => {
  res.render('users/form', { title: 'Add User', item: { role: 'user' }, errors: [], action: '/users', isEdit: false, ROLES });
});

router.post('/', (req, res) => {
  const { u, errors } = validate(req.body, { requirePassword: true });
  if (errors.length) return res.status(422).render('users/form', { title: 'Add User', item: req.body, errors, action: '/users', isEdit: false, ROLES });
  db.prepare('INSERT INTO users (name,username,email,password,role) VALUES (?,?,?,?,?)')
    .run(u.name, u.username, u.email, bcrypt.hashSync(u.password, 10), u.role);
  setFlash(req, 'success', `User "${u.username}" created.`);
  res.redirect('/users');
});

// MODIFY
router.get('/:id/edit', (req, res, next) => {
  const item = db.prepare('SELECT id,name,username,email,role FROM users WHERE id = ?').get(req.params.id);
  if (!item) return next();
  res.render('users/form', { title: 'Edit User', item, errors: [], action: `/users/${item.id}?_method=PUT`, isEdit: true, ROLES });
});

router.put('/:id', (req, res, next) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return next();
  const { u, errors } = validate(req.body, { id: existing.id, requirePassword: false });
  if (existing.role === 'admin' && u.role !== 'admin' && adminCount() <= 1) errors.push('Cannot demote the last admin.');
  if (existing.id === req.session.user.id && u.role !== 'admin') errors.push('You cannot remove your own admin role.');
  if (errors.length) {
    return res.status(422).render('users/form', { title: 'Edit User', item: { ...req.body, id: existing.id }, errors, action: `/users/${existing.id}?_method=PUT`, isEdit: true, ROLES });
  }
  const hash = u.password ? bcrypt.hashSync(u.password, 10) : existing.password;
  db.prepare('UPDATE users SET name=?, username=?, email=?, role=?, password=? WHERE id=?')
    .run(u.name, u.username, u.email, u.role, hash, existing.id);
  if (existing.id === req.session.user.id) Object.assign(req.session.user, { name: u.name, username: u.username });
  setFlash(req, 'success', `User "${u.username}" updated.`);
  res.redirect('/users');
});

// DELETE
router.delete('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!item) return res.redirect('/users');
  if (item.id === req.session.user.id) setFlash(req, 'error', 'You cannot delete your own account.');
  else if (item.role === 'admin' && adminCount() <= 1) setFlash(req, 'error', 'Cannot delete the last admin.');
  else {
    db.prepare('DELETE FROM users WHERE id = ?').run(item.id);
    setFlash(req, 'success', `User "${item.username}" deleted.`);
  }
  res.redirect('/users');
});

module.exports = router;
