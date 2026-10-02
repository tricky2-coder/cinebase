const db = require('../db');

const OMDB_API_KEY = process.env.OMDB_API_KEY || '6d26314e';

// Curated list of popular IMDb IDs to seed your catalogue
const IMDB_IDS = [
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
  'tt0944947', // Stranger Things (via IMDb)
  'tt4052886', // Lucifer
  'tt2570858', // Peaky Blinders
  'tt1475582', // Sherlock
  'tt0386676'  // The Office
];

const insertStmt = db.prepare(`
  INSERT INTO titles (title, type, genre, release_year, rating, poster_url, synopsis, imdb_id)
  VALUES (@title, @type, @genre, @release_year, @rating, @poster_url, @synopsis, @imdb_id)
  ON CONFLICT(imdb_id) DO UPDATE SET
    rating = excluded.rating,
    poster_url = excluded.poster_url,
    synopsis = excluded.synopsis
`);

async function fetchAndSave(imdbId) {
  try {
    const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.Response === 'False') {
      console.error(`[Error] ${imdbId}:`, data.Error);
      return;
    }

    const isSeries = data.Type === 'series';

    insertStmt.run({
      title: data.Title,
      type: isSeries ? 'Series' : 'Movie',
      genre: data.Genre ? data.Genre.split(',')[0].trim() : 'Drama',
      release_year: parseInt(data.Year) || null,
      rating: parseFloat(data.imdbRating) || null,
      poster_url: data.Poster !== 'N/A' ? data.Poster : null,
      synopsis: data.Plot !== 'N/A' ? data.Plot : null,
      imdb_id: data.imdbID
    });

    console.log(`[Saved] ${data.Title} (${data.Type})`);
  } catch (err) {
    console.error(`[Failed] ID ${imdbId}:`, err.message);
  }
}

async function main() {
  console.log('Seeding Cinebase catalogue via OMDb...');
  for (const id of IMDB_IDS) {
    await fetchAndSave(id);
  }
  console.log('✅ Catalogue population complete!');
}

main();