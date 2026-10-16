// express-session store backed by the app database (Turso or the local SQLite file).
// With Turso every server instance shares the same sessions, so logins survive restarts,
// deploys and requests landing on different Vercel instances. Expired rows are pruned periodically.
const session = require('express-session');

const DAY = 24 * 60 * 60 * 1000;

class SqlStore extends session.Store {
  constructor(db, { pruneEveryMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    db.ready.then(() => this.prune()).catch(() => {});
    setInterval(() => this.prune(), pruneEveryMs).unref();
  }

  static expiry(sess) {
    const e = sess?.cookie?.expires;
    return e ? new Date(e).getTime() : Date.now() + DAY;
  }

  prune() {
    return this.db.run('DELETE FROM sessions WHERE expires <= ?', Date.now()).catch(e => console.error('Session prune failed:', e.message));
  }

  get(sid, cb) {
    this.db.get('SELECT sess FROM sessions WHERE sid = ? AND expires > ?', sid, Date.now())
      .then(row => cb(null, row ? JSON.parse(row.sess) : null), cb);
  }

  set(sid, sess, cb = () => {}) {
    this.db.run(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
    sid, JSON.stringify(sess), SqlStore.expiry(sess)).then(() => cb(null), cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.db.run('UPDATE sessions SET expires = ? WHERE sid = ?', SqlStore.expiry(sess), sid).then(() => cb(null), cb);
  }

  destroy(sid, cb = () => {}) {
    this.db.run('DELETE FROM sessions WHERE sid = ?', sid).then(() => cb(null), cb);
  }
}

module.exports = SqlStore;
