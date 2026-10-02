// express-session store backed by the app's SQLite database (node:sqlite, no native build).
// Sessions survive restarts; expired rows are pruned periodically.
const session = require('express-session');

const DAY = 24 * 60 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor(db, { pruneEveryMs = 15 * 60 * 1000 } = {}) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expires INTEGER NOT NULL
    )`);
    this.q = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires <= ?')
    };
    this.prune();
    setInterval(() => this.prune(), pruneEveryMs).unref();
  }

  static expiry(sess) {
    const e = sess?.cookie?.expires;
    return e ? new Date(e).getTime() : Date.now() + DAY;
  }

  prune() {
    this.q.prune.run(Date.now());
  }

  get(sid, cb) {
    try {
      const row = this.q.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.q.set.run(sid, JSON.stringify(sess), SqliteStore.expiry(sess));
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this.q.touch.run(SqliteStore.expiry(sess), sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.q.destroy.run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

module.exports = SqliteStore;
