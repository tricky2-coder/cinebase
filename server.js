const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const helmet = require('helmet');

const IS_PROD = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET) {
  if (IS_PROD) {
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  console.warn('Warning: SESSION_SECRET is not set; using a random secret (sessions reset on restart).');
}

const db = require('./db');
const SqliteStore = require('./services/session-store');
const { requireLogin } = require('./middleware/auth');

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
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      // Any https frame: VidSrc mirrors change domains and redirect, so pinning them would break the player
      frameSrc: ["'self'", 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  // YouTube embeds fail without a Referer; this is also the browser default
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteStore(db),
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

// Flash messages + current user available in every view
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/dashboard', requireLogin, require('./routes/dashboard'));
app.use('/titles', requireLogin, require('./routes/titles'));
app.use('/users', requireLogin, require('./routes/users'));
app.use('/plex', requireLogin, require('./routes/plex'));
app.use('/', require('./routes/site')); // public catalogue frontend

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

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
