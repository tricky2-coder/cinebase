const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');

const db = require('./db');
const { requireLogin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // needed behind Render/Railway proxies for secure cookies

app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

// Flash messages + current user available in every view
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));

app.get('/dashboard', requireLogin, (req, res) => {
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

app.use('/titles', requireLogin, require('./routes/titles'));
app.use('/users', requireLogin, require('./routes/users'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`CineBase running on http://localhost:${PORT}`));
