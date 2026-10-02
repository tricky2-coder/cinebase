const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no native build needed
const bcrypt = require('bcryptjs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'cinebase.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
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
`);

// Media / integration columns — added via migration so existing databases upgrade in place
const existingCols = db.prepare('PRAGMA table_info(titles)').all().map(c => c.name);
const newCols = {
  poster_url: 'TEXT',
  backdrop_url: 'TEXT',
  trailer_key: 'TEXT',          // YouTube video id
  tmdb_id: 'INTEGER',
  plex_rating_key: 'TEXT'       // links the record to an item on your Plex server
};
for (const [col, type] of Object.entries(newCols)) {
  if (!existingCols.includes(col)) db.exec(`ALTER TABLE titles ADD COLUMN ${col} ${type}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_titles_plex ON titles(plex_rating_key) WHERE plex_rating_key IS NOT NULL');

// Seed default admin
const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser)) {
  db.prepare(
    'INSERT INTO users (name, username, email, password, role) VALUES (?, ?, ?, ?, ?)'
  ).run('Administrator', adminUser, 'admin@cinebase.local', bcrypt.hashSync(adminPass, 10), 'admin');
  console.log(`Seeded admin account -> username: ${adminUser}`);
}

// Seed sample titles
if (db.prepare('SELECT COUNT(*) AS c FROM titles').get().c === 0) {
  const ins = db.prepare(`INSERT INTO titles
    (title, type, genre, language, release_year, director, cast_members, seasons, duration_min, rating, platform, status, synopsis)
    VALUES (@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@platform,@status,@synopsis)`);
  const samples = [
    { title: 'Inception', type: 'Movie', genre: 'Sci-Fi', language: 'English', release_year: 2010, director: 'Christopher Nolan', cast_members: 'Leonardo DiCaprio, Joseph Gordon-Levitt', seasons: null, duration_min: 148, rating: 8.8, platform: 'Netflix', status: 'Released', synopsis: 'A thief who steals secrets through dream-sharing is given a chance at redemption.' },
    { title: 'Breaking Bad', type: 'Series', genre: 'Crime', language: 'English', release_year: 2008, director: 'Vince Gilligan', cast_members: 'Bryan Cranston, Aaron Paul', seasons: 5, duration_min: 47, rating: 9.5, platform: 'Netflix', status: 'Ended', synopsis: 'A chemistry teacher turns to manufacturing drugs to secure his family\'s future.' },
    { title: '3 Idiots', type: 'Movie', genre: 'Comedy', language: 'Hindi', release_year: 2009, director: 'Rajkumar Hirani', cast_members: 'Aamir Khan, R. Madhavan, Sharman Joshi', seasons: null, duration_min: 170, rating: 8.4, platform: 'Prime Video', status: 'Released', synopsis: 'Two friends search for their long-lost college companion.' },
    { title: 'Sacred Games', type: 'Series', genre: 'Thriller', language: 'Hindi', release_year: 2018, director: 'Anurag Kashyap', cast_members: 'Saif Ali Khan, Nawazuddin Siddiqui', seasons: 2, duration_min: 50, rating: 8.5, platform: 'Netflix', status: 'Ended', synopsis: 'A Mumbai police officer receives a cryptic call from a notorious gangster.' },
    { title: 'Interstellar', type: 'Movie', genre: 'Sci-Fi', language: 'English', release_year: 2014, director: 'Christopher Nolan', cast_members: 'Matthew McConaughey, Anne Hathaway', seasons: null, duration_min: 169, rating: 8.7, platform: 'Prime Video', status: 'Released', synopsis: 'Explorers travel through a wormhole in search of a new home for humanity.' },
    { title: 'Panchayat', type: 'Series', genre: 'Comedy', language: 'Hindi', release_year: 2020, director: 'Deepak Kumar Mishra', cast_members: 'Jitendra Kumar, Neena Gupta', seasons: 4, duration_min: 32, rating: 9.0, platform: 'Prime Video', status: 'Ongoing', synopsis: 'An engineering graduate becomes secretary of a remote village panchayat.' },
    { title: 'Stranger Things', type: 'Series', genre: 'Horror', language: 'English', release_year: 2016, director: 'The Duffer Brothers', cast_members: 'Millie Bobby Brown, Finn Wolfhard', seasons: 5, duration_min: 51, rating: 8.7, platform: 'Netflix', status: 'Ended', synopsis: 'Kids in a small town uncover supernatural experiments and a parallel world.' },
    { title: 'RRR', type: 'Movie', genre: 'Action', language: 'Telugu', release_year: 2022, director: 'S. S. Rajamouli', cast_members: 'N. T. Rama Rao Jr., Ram Charan', seasons: null, duration_min: 187, rating: 7.8, platform: 'Netflix', status: 'Released', synopsis: 'A fictional story of two revolutionaries in 1920s India.' }
  ];
  db.exec('BEGIN');
  try { samples.forEach(r => ins.run(r)); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Seeded ${samples.length} sample titles`);
}

module.exports = db;
