// Vidy player service (movies, TV series, anime)
// Full feature suite for Vidy:
// - color=F5B301: Custom gold accent color for buttons, progress bar & focus rings
// - autoplay=true: Start playback with sound as soon as stream loads
// - nextEpisode=true: Display "Next Episode" button in Vidy's controls
// - episodeSelector=true: Display "Episodes" menu/drawer in Vidy's controls
// Auto-next is seamlessly driven by CineBase so all flags remain active across every episode.

const VIDY = 'www.vidy.st';

function player(item, { seasons = null, tvId = null } = {}) {
  const isSeries = item.type === 'Series';
  const isAnime = Boolean(item.anilist_id);
  const id = isAnime ? String(item.anilist_id) : String(item.tmdb_id || item.imdb_id);
  if (!id) return null;

  const fallbackSeasons = Array.from({ length: item.seasons || 1 }, (_, i) => ({ n: i + 1, name: `Season ${i + 1}`, episodes: null }));
  const seasonList = isSeries ? (seasons?.length ? seasons : fallbackSeasons) : null;

  const seriesFlags = 'color=F5B301&autoplay=true&nextEpisode=true&episodeSelector=true&progress=0';
  const movieFlags = 'color=F5B301&autoplay=true&progress=0';

  const path = isAnime
    ? (isSeries ? `/anime/{id}/{e}?${seriesFlags}` : `/anime/{id}/1?${movieFlags}`)
    : (isSeries ? `/tv/{id}/{s}/{e}?${seriesFlags}` : `/movie/{id}?${movieFlags}`);

  const initialSrc = `https://${VIDY}` + path
    .replace('{id}', encodeURIComponent(id))
    .replace('{s}', '1')
    .replace('{e}', '1');

  return {
    src: initialSrc,
    isSeries,
    isAnime,
    seasons: seasonList,
    cfg: {
      isSeries,
      anime: isAnime,
      tvId: isAnime ? null : (tvId || item.tmdb_id || null),
      key: isAnime ? `a${id}` : String(tvId || item.tmdb_id || item.imdb_id),
      epBase: isAnime ? `/episodes/anime/${id}/` : (tvId ? `/episodes/${tvId}/` : null),
      path,
      id,
      domain: VIDY,
      seasons: seasonList
    }
  };
}

module.exports = { player, VIDY };
