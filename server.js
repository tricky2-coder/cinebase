const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const helmet = require('helmet');

const IS_PROD = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET is not set; using a random secret. Set SESSION_SECRET in production to persist sessions across restarts.');
}

const db = require('./db');
const SqlStore = require('./services/session-store');
const { requireUser, requireAdmin } = require('./middleware/auth');
const tmdb = require('./services/tmdb');
const plex = require('./services/plex');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // needed behind Render/Railway proxies for secure cookies
// One string per key: `?genre=a&genre=b` becomes genre=b instead of an array that breaks SQL bindings
app.set('query parser', qs => Object.fromEntries(new URLSearchParams(qs)));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'none'"],
      workerSrc: ["'self'", 'blob:'],
      mediaSrc: ["'self'", 'blob:', 'https:', 'http:'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      // Any https frame: VidSrc mirrors change domains and redirect, so pinning them would break the player
      frameSrc: ["'self'", 'https:'],
      connectSrc: ["'self'", 'blob:', 'https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  // YouTube embeds fail without a Referer; this is also the browser default
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Safe default view locals on every incoming request
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.activeProfile = null;
  res.locals.userProfiles = [];
  res.locals.flash = null;
  res.locals.path = req.path || '/';
  res.locals.showWhosWatching = false;
  res.locals.tmdbEnabled = tmdb.enabled();
  res.locals.plexEnabled = plex.enabled();
  res.locals.q = '';
  res.locals.query = {};
  next();
});

// Everything below needs the database schema in place (matters on serverless cold starts)
app.use((req, res, next) => db.ready.then(() => next(), next));

app.use(session({
  store: new SqlStore(db),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

// Re-read the signed-in account on every request, so deleting a user or changing their role applies immediately
app.use(async (req, res, next) => {
  if (req.session.user) {
    const fresh = await db.get('SELECT id, name, username, role FROM users WHERE id = ?', req.session.user.id);
    if (fresh) {
      req.session.user = { ...fresh };
      // Ensure active profile exists
      let profile = null;
      if (req.session.activeProfileId) {
        profile = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.session.activeProfileId, fresh.id);
      }
      if (!profile) {
        profile = await db.get('SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1', fresh.id);
        if (!profile) {
          const defaultAvatar = '/profiles/avatars/purple-superhero.svg';
          const r = await db.run('INSERT INTO profiles (user_id, name, avatar, is_kids) VALUES (?, ?, ?, 0)', fresh.id, 'Me', defaultAvatar);
          profile = { id: r.lastInsertRowid, user_id: fresh.id, name: 'Me', avatar: defaultAvatar, is_kids: 0 };
        }
        req.session.activeProfileId = profile.id;
      }
      req.session.activeProfile = profile;
      res.locals.userProfiles = await db.all('SELECT id, user_id, name, avatar, is_kids, (pin IS NOT NULL) AS has_pin, created_at FROM profiles WHERE user_id = ? ORDER BY id ASC', fresh.id);
    } else {
      delete req.session.user;
      delete req.session.activeProfileId;
      delete req.session.activeProfile;
    }
  }
  next();
});

// Flash messages + current user + active profile available in every view
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.activeProfile = req.session.activeProfile || null;
  res.locals.userProfiles = res.locals.userProfiles || [];
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  res.locals.showWhosWatching = !!(req.session.justLoggedIn || req.query.whosWatching);
  res.locals.tmdbEnabled = tmdb.enabled();
  res.locals.plexEnabled = plex.enabled();
  res.locals.q = '';
  res.locals.query = req.query || {};
  delete req.session.justLoggedIn;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/dashboard', requireAdmin, require('./routes/dashboard'));
app.use('/titles', requireAdmin, require('./routes/titles'));
app.use('/users', requireAdmin, require('./routes/users'));
app.use('/plex', requireAdmin, require('./routes/plex'));
app.use('/', require('./routes/profiles'));
app.use('/', requireUser, require('./routes/site')); // the movie site — any signed-in account

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error('[CineBase 500 Error]', req.method, req.url, err);
  res.status(500).render('error', {
    title: 'Something Went Wrong',
    message: err.message || 'An unexpected error occurred. Please try again.'
  });
});

db.ready.catch(e => {
  console.error('FATAL: database setup failed:', e);
});

if (require.main === module || !process.env.VERCEL) {
  const server = app.listen(PORT, () => console.log(`CineBase running on http://localhost:${PORT}`));

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

module.exports = app;
