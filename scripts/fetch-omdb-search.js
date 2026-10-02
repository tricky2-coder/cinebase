const db = require('../db');

const OMDB_API_KEY = process.env.OMDB_API_KEY || '6d26314e';

// Search terms to query and populate catalog
const SEARCH_QUERIES = ['Marvel', 'Batman', 'Star Wars', 'Avengers', 'Spider-Man'];

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO titles (id, title, type, genre, release_year, rating, poster_url, synopsis, language, imdb_id)
  VALUES (
    (SELECT id FROM titles WHERE imdb_id = @imdb_id),
    @title, @type, @genre, @release_year, @rating, @poster_url, @synopsis, @language, @imdb_id
  )
`);

async function fetchByImdbId(imdbId) {
  try {
    const res = await fetch(`http://www.omdbapi.com/?i=${imdbId}&plot=full&apikey=${OMDB_API_KEY}`);
    const data = await res.json();

    if (data.Response === 'False') return;

    const isSeries = data.Type === 'series';

    // Parse language safely (e.g. "English, Spanish" -> "English")
    const primaryLanguage = (data.Language && data.Language !== 'N/A') 
      ? data.Language.split(',')[0].trim() 
      : 'English';

    insertStmt.run({
      title: data.Title,
      type: isSeries ? 'Series' : 'Movie',
      genre: (data.Genre && data.Genre !== 'N/A') ? data.Genre.split(',')[0].trim() : 'Action',
      release_year: parseInt(data.Year) || null,
      rating: parseFloat(data.imdbRating) || null,
      poster_url: data.Poster !== 'N/A' ? data.Poster : null,
      synopsis: data.Plot !== 'N/A' ? data.Plot : null,
      language: primaryLanguage,
      imdb_id: data.imdbID
    });

    console.log(`[Imported] ${data.Title} (${data.Year}) - ${primaryLanguage} - IMDb ID: ${data.imdbID}`);
  } catch (err) {
    console.error(`Error importing ID ${imdbId}:`, err.message);
  }
}

async function searchAndImport(query) {
  console.log(`Searching OMDb for "${query}"...`);
  try {
    const res = await fetch(`http://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${OMDB_API_KEY}`);
    const data = await res.json();

    if (data.Response === 'True' && data.Search) {
      for (const item of data.Search) {
        await fetchByImdbId(item.imdbID);
      }
    }
  } catch (err) {
    console.error(`Failed search for "${query}":`, err.message);
  }
}

async function main() {
  for (const q of SEARCH_QUERIES) {
    await searchAndImport(q);
  }
  console.log('✅ Batch search import complete!');
}

main();