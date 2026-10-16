// Database layer. Two backends behind one async API:
//   - Turso (hosted SQLite) when TURSO_DATABASE_URL is set — shared by every server instance,
//     so accounts, sessions and titles survive deploys and work on Vercel.
//   - A local SQLite file (node:sqlite, built into Node 22.13+) otherwise.
// API: db.get / db.all / db.run (sql, ...params | {named}), db.exec(sql), db.transaction(async tx => …),
//      db.ready (resolves once the schema is in place), db.close().
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const TURSO_URL = (process.env.TURSO_DATABASE_URL || '').trim();

// "@name" placeholders -> "?" with an ordered argument list (outside string literals only),
// so both backends see plain positional parameters.
function bind(sql, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const named = args[0];
    const values = [];
    const out = sql.split("'").map((part, i) => (i % 2 ? part : part.replace(/@([A-Za-z_]\w*)/g, (_, k) => {
      if (!(k in named)) throw new Error(`Missing SQL parameter @${k}`);
      values.push(named[k]);
      return '?';
    }))).join("'");
    return { sql: out, args: values.map(clean) };
  }
  const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return { sql, args: flat.map(clean) };
}
const clean = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

function localBackend() {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(dataDir, 'cinebase.db'));
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const stmts = new Map();
  const stmt = sql => { if (!stmts.has(sql)) stmts.set(sql, conn.prepare(sql)); return stmts.get(sql); };
  const api = {
    async get(sql, ...a) { const b = bind(sql, a); return stmt(b.sql).get(...b.args); },
    async all(sql, ...a) { const b = bind(sql, a); return stmt(b.sql).all(...b.args); },
    async run(sql, ...a) {
      const b = bind(sql, a);
      const r = stmt(b.sql).run(...b.args);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) { conn.exec(sql); }
  };
  return {
    ...api,
    kind: 'local',
    async transaction(fn) {
      conn.exec('BEGIN');
      try { const r = await fn(api); conn.exec('COMMIT'); return r; }
      catch (e) { conn.exec('ROLLBACK'); throw e; }
    },
    close() { conn.close(); }
  };
}

function tursoBackend() {
  const { createClient } = require('@libsql/client/web'); // HTTP client, no native module
  const client = createClient({ url: TURSO_URL, authToken: (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined });
  const rows = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
  const on = target => ({
    async get(sql, ...a) { return rows(await target.execute(bind(sql, a)))[0]; },
    async all(sql, ...a) { return rows(await target.execute(bind(sql, a))); },
    async run(sql, ...a) {
      const rs = await target.execute(bind(sql, a));
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
    },
    async exec(sql) { await target.executeMultiple(sql); }
  });
  return {
    ...on(client),
    kind: 'turso',
    async transaction(fn) {
      const tx = await client.transaction('write');
      try { const r = await fn(on(tx)); await tx.commit(); return r; }
      catch (e) { await tx.rollback().catch(() => {}); throw e; }
      finally { tx.close(); }
    },
    close() { client.close(); }
  };
}

const db = TURSO_URL ? tursoBackend() : localBackend();

// Several server instances can start at once against the same Turso database:
// schema steps and seeds must tolerate another instance having just done the same.
const ignoreRace = re => e => { if (!re.test(e.message)) throw e; };

async function init() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      username    TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS titles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      type         TEXT NOT NULL CHECK (type IN ('Movie','Series')),
      genre        TEXT NOT NULL,
      language     TEXT NOT NULL,
      release_year INTEGER NOT NULL,
      director     TEXT,
      cast_members TEXT,
      seasons      INTEGER,
      duration_min INTEGER,
      rating       REAL CHECK (rating BETWEEN 0 AND 10),
      platform     TEXT,
      status       TEXT NOT NULL DEFAULT 'Released' CHECK (status IN ('Released','Ongoing','Upcoming','Ended')),
      synopsis     TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `);

  // Media / integration columns — added via migration so existing databases upgrade in place
  const existingCols = (await db.all('PRAGMA table_info(titles)')).map(c => c.name);
  const newCols = {
    poster_url: 'TEXT',
    backdrop_url: 'TEXT',
    trailer_key: 'TEXT',          // YouTube video id
    imdb_id: 'TEXT',              // IMDb ID (e.g. tt1375666) for VidSrc playback
    tmdb_id: 'INTEGER',           // TMDB ID for VidSrc playback
    plex_rating_key: 'TEXT',      // links the record to an item on your Plex server
    tmdb_checked_at: 'TEXT'       // last TMDB enrich attempt, so unmatched titles aren't retried every run
  };
  for (const [col, type] of Object.entries(newCols)) {
    if (!existingCols.includes(col)) await db.exec(`ALTER TABLE titles ADD COLUMN ${col} ${type}`).catch(ignoreRace(/duplicate column/i));
  }
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_titles_plex ON titles(plex_rating_key) WHERE plex_rating_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_titles_genre ON titles(genre);
    CREATE INDEX IF NOT EXISTS idx_titles_type ON titles(type);
    CREATE INDEX IF NOT EXISTS idx_titles_rating ON titles(rating);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
  `);

  // One record per IMDb ID. Existing duplicates must be merged by hand before the index can be created.
  const imdbDupes = await db.all(`SELECT imdb_id, GROUP_CONCAT(id) ids FROM titles
    WHERE imdb_id IS NOT NULL GROUP BY imdb_id HAVING COUNT(*) > 1`);
  if (imdbDupes.length) {
    console.warn('Warning: duplicate imdb_id values, unique index not created:');
    imdbDupes.forEach(d => console.warn(`  ${d.imdb_id} -> title ids ${d.ids}`));
  } else {
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_titles_imdb ON titles(imdb_id) WHERE imdb_id IS NOT NULL');
  }

  // Seed default admin
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (!(await db.get('SELECT id FROM users WHERE username = ?', adminUser))) {
    if (process.env.NODE_ENV === 'production' && adminPass === 'admin123') {
      throw new Error('Set ADMIN_PASSWORD (not the default) before the first production start.');
    }
    await db.run('INSERT INTO users (name, username, email, password, role) VALUES (?, ?, ?, ?, ?)',
      'Administrator', adminUser, 'admin@cinebase.local', bcrypt.hashSync(adminPass, 10), 'admin')
      .then(() => console.log(`Seeded admin account -> username: ${adminUser}`))
      .catch(ignoreRace(/UNIQUE constraint/i));
  }

  // Seed sample titles
  if ((await db.get('SELECT COUNT(*) AS c FROM titles')).c === 0) {
    const samples = [
      { title: 'Inception', type: 'Movie', genre: 'Sci-Fi', language: 'English', release_year: 2010, director: 'Christopher Nolan', cast_members: 'Leonardo DiCaprio, Joseph Gordon-Levitt', seasons: null, duration_min: 148, rating: 8.8, platform: 'Netflix', status: 'Released', synopsis: 'A thief who steals secrets through dream-sharing is given a chance at redemption.', imdb_id: 'tt1375666', tmdb_id: 27205 },
      { title: 'Breaking Bad', type: 'Series', genre: 'Crime', language: 'English', release_year: 2008, director: 'Vince Gilligan', cast_members: 'Bryan Cranston, Aaron Paul', seasons: 5, duration_min: 47, rating: 9.5, platform: 'Netflix', status: 'Ended', synopsis: 'A chemistry teacher turns to manufacturing drugs to secure his family\'s future.', imdb_id: 'tt0903747', tmdb_id: 1396 },
      { title: '3 Idiots', type: 'Movie', genre: 'Comedy', language: 'Hindi', release_year: 2009, director: 'Rajkumar Hirani', cast_members: 'Aamir Khan, R. Madhavan, Sharman Joshi', seasons: null, duration_min: 170, rating: 8.4, platform: 'Prime Video', status: 'Released', synopsis: 'Two friends search for their long-lost college companion.', imdb_id: 'tt1187043', tmdb_id: 20453 },
      { title: 'Sacred Games', type: 'Series', genre: 'Thriller', language: 'Hindi', release_year: 2018, director: 'Anurag Kashyap', cast_members: 'Saif Ali Khan, Nawazuddin Siddiqui', seasons: 2, duration_min: 50, rating: 8.5, platform: 'Netflix', status: 'Ended', synopsis: 'A Mumbai police officer receives a cryptic call from a notorious gangster.', imdb_id: 'tt6077448', tmdb_id: 79813 },
      { title: 'Interstellar', type: 'Movie', genre: 'Sci-Fi', language: 'English', release_year: 2014, director: 'Christopher Nolan', cast_members: 'Matthew McConaughey, Anne Hathaway', seasons: null, duration_min: 169, rating: 8.7, platform: 'Prime Video', status: 'Released', synopsis: 'Explorers travel through a wormhole in search of a new home for humanity.', imdb_id: 'tt0816692', tmdb_id: 157336 },
      { title: 'Panchayat', type: 'Series', genre: 'Comedy', language: 'Hindi', release_year: 2020, director: 'Deepak Kumar Mishra', cast_members: 'Jitendra Kumar, Neena Gupta', seasons: 4, duration_min: 32, rating: 9.0, platform: 'Prime Video', status: 'Ongoing', synopsis: 'An engineering graduate becomes secretary of a remote village panchayat.', imdb_id: 'tt12004706', tmdb_id: 101188 },
      { title: 'Stranger Things', type: 'Series', genre: 'Horror', language: 'English', release_year: 2016, director: 'The Duffer Brothers', cast_members: 'Millie Bobby Brown, Finn Wolfhard', seasons: 5, duration_min: 51, rating: 8.7, platform: 'Netflix', status: 'Ended', synopsis: 'Kids in a small town uncover supernatural experiments and a parallel world.', imdb_id: 'tt4574334', tmdb_id: 66732 },
      { title: 'RRR', type: 'Movie', genre: 'Action', language: 'Telugu', release_year: 2022, director: 'S. S. Rajamouli', cast_members: 'N. T. Rama Rao Jr., Ram Charan', seasons: null, duration_min: 187, rating: 7.8, platform: 'Netflix', status: 'Released', synopsis: 'A fictional story of two revolutionaries in 1920s India.', imdb_id: 'tt8178634', tmdb_id: 579974 }
    ];
    // A concurrent instance seeding at the same time trips the imdb_id unique index; its copy wins
    await db.transaction(async tx => {
      for (const r of samples) {
        await tx.run(`INSERT INTO titles
          (title, type, genre, language, release_year, director, cast_members, seasons, duration_min, rating, platform, status, synopsis, imdb_id, tmdb_id)
          VALUES (@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@platform,@status,@synopsis,@imdb_id,@tmdb_id)`, r);
      }
    }).then(() => console.log(`Seeded ${samples.length} sample titles`)).catch(ignoreRace(/UNIQUE constraint/i));
  }
}

db.ready = init();
db.ready.catch(() => {}); // surfaced by whoever awaits it (server start-up / request middleware)
if (db.kind === 'turso') console.log('Database: Turso', TURSO_URL.replace(/^libsql:\/\//, ''));

module.exports = db;
