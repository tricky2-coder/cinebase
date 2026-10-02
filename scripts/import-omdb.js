// Import titles from OMDb (https://www.omdbapi.com) by IMDb ID or by search term.
//   npm run import:omdb                                  -> curated list below
//   npm run import:omdb -- --ids tt0133093 tt0110912
//   npm run import:omdb -- --search Batman "Star Wars"
// Existing titles (same imdb_id, or same title/type/year without one) are updated in place:
// missing fields are filled and the rating refreshed. Plex links, TMDB data, trailers and manual edits are kept.
const db = require('../db');

const KEY = (process.env.OMDB_API_KEY || '').trim();
if (!KEY) {
  console.error('Set OMDB_API_KEY in .env (free key: https://www.omdbapi.com/apikey.aspx).');
  process.exit(1);
}

const CURATED = [
  // Movies
  'tt1375666', // Inception
  'tt0816692', // Interstellar
  'tt0111161', // The Shawshank Redemption
  'tt0468569', // The Dark Knight
  'tt0133093', // The Matrix
  'tt0110912', // Pulp Fiction
  'tt10872600', // Spider-Man: No Way Home
  'tt2543164', // Arrival
  'tt0120338', // Titanic
  'tt6751668', // Parasite
  // Series
  'tt0903747', // Breaking Bad
  'tt0944947', // Game of Thrones
  'tt1190634', // The Boys
  'tt4574334', // Stranger Things
  'tt4052886', // Lucifer
  'tt2442560', // Peaky Blinders
  'tt1475582', // Sherlock
  'tt0386676'  // The Office
];

const na = v => (v && v !== 'N/A' ? v : null);
const first = v => na(v)?.split(',')[0].trim() || null;

async function omdb(params) {
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (data.Response === 'False') throw new Error(data.Error || `OMDb ${res.status}`);
  return data;
}

// OMDb record -> CineBase title fields (null if it can't satisfy the required columns)
function toTitle(d) {
  const year = parseInt(d.Year, 10);
  if (!year || !na(d.Title)) return null;
  const isSeries = d.Type === 'series';
  // Series years look like "2008–2013" (ended) or "2016–" (still running)
  const status = !isSeries ? 'Released' : /\d{4}\D\d{4}/.test(d.Year) ? 'Ended' : /\D$/.test(d.Year) ? 'Ongoing' : 'Released';
  const rating = parseFloat(d.imdbRating);
  return {
    imdb_id: d.imdbID,
    title: d.Title,
    type: isSeries ? 'Series' : 'Movie',
    genre: first(d.Genre) || 'Drama',
    language: first(d.Language) || 'Unknown',
    release_year: year,
    director: na(d.Director),
    cast_members: na(d.Actors),
    seasons: isSeries ? parseInt(d.totalSeasons, 10) || null : null,
    duration_min: parseInt(d.Runtime, 10) || null,
    rating: rating >= 0 && rating <= 10 ? rating : null,
    status,
    synopsis: na(d.Plot),
    poster_url: na(d.Poster)
  };
}

const q = {
  byImdb: db.prepare('SELECT id FROM titles WHERE imdb_id = ?'),
  byTitle: db.prepare(`SELECT id FROM titles WHERE imdb_id IS NULL AND type = ? AND lower(title) = lower(?)
    AND release_year BETWEEN ? - 1 AND ? + 1 ORDER BY id LIMIT 1`),
  insert: db.prepare(`INSERT INTO titles
    (imdb_id,title,type,genre,language,release_year,director,cast_members,seasons,duration_min,rating,status,synopsis,poster_url)
    VALUES (@imdb_id,@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@status,@synopsis,@poster_url)`),
  update: db.prepare(`UPDATE titles SET imdb_id=@imdb_id, rating=COALESCE(@rating,rating), seasons=COALESCE(@seasons,seasons),
    director=COALESCE(director,@director), cast_members=COALESCE(cast_members,@cast_members),
    duration_min=COALESCE(duration_min,@duration_min), synopsis=COALESCE(synopsis,@synopsis),
    poster_url=COALESCE(poster_url,@poster_url), updated_at=datetime('now') WHERE id=@id`)
};

const stats = { added: 0, updated: 0, skipped: 0, failed: 0 };

async function importId(imdbId) {
  try {
    const t = toTitle(await omdb({ i: imdbId, plot: 'short' }));
    if (!t) { stats.skipped++; console.log(`[skip]    ${imdbId}: no title or release year`); return; }
    const existing = q.byImdb.get(t.imdb_id) || q.byTitle.get(t.type, t.title, t.release_year, t.release_year);
    if (existing) {
      // node:sqlite rejects named parameters the statement doesn't use, so pass only these
      const { imdb_id, rating, seasons, director, cast_members, duration_min, synopsis, poster_url } = t;
      q.update.run({ imdb_id, rating, seasons, director, cast_members, duration_min, synopsis, poster_url, id: existing.id });
      stats.updated++;
      console.log(`[update]  ${t.title} (${t.release_year})`);
    } else {
      q.insert.run(t);
      stats.added++;
      console.log(`[add]     ${t.title} (${t.release_year})`);
    }
  } catch (e) {
    stats.failed++;
    console.error(`[fail]    ${imdbId}: ${e.message}`);
  }
}

async function searchIds(term) {
  try {
    const data = await omdb({ s: term });
    return data.Search.filter(r => r.Type === 'movie' || r.Type === 'series').map(r => r.imdbID);
  } catch (e) {
    console.error(`[fail]    search "${term}": ${e.message}`);
    return [];
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  let ids;
  if (mode === '--ids') ids = args;
  else if (mode === '--search') {
    ids = [];
    for (const term of args) {
      console.log(`Searching OMDb for "${term}"…`);
      ids.push(...await searchIds(term));
    }
  } else if (!mode) ids = CURATED;
  else {
    console.error('Usage: import-omdb.js [--ids tt… tt…] [--search "term" …]');
    process.exit(1);
  }

  for (const id of new Set(ids)) await importId(id);
  console.log(`Done: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.failed} failed.`);
  db.close();
}

main();
