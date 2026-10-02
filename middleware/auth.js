function requireLogin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.session.flash = { type: 'error', msg: 'Please log in to continue.' };
  return res.redirect('/login');
}

function setFlash(req, type, msg) {
  req.session.flash = { type, msg };
}

module.exports = { requireLogin, setFlash };
