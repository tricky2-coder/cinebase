// Any signed-in account (admin or user) — the movie site
function requireUser(req, res, next) {
  if (req.session.user) return next();
  const target = req.method === 'GET' && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(`/login${target}`);
}

// Admins only — dashboard, catalogue management, users, Plex
function requireAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  if (req.session.user) return res.redirect('/'); // signed-in users just get the movie site
  req.session.flash = { type: 'error', msg: 'Please log in to continue.' };
  return res.redirect('/login');
}

// Only allow redirects back into this site after login ("//x" and "/\x" would leave the site)
const safeNext = v => (typeof v === 'string' && /^\/(?![\/\\])/.test(v) && !v.startsWith('/login') ? v : null);

function setFlash(req, type, msg) {
  req.session.flash = { type, msg };
}

module.exports = { requireUser, requireAdmin, safeNext, setFlash };
