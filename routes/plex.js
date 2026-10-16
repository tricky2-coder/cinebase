const express = require('express');
const db = require('../db');
const plex = require('../services/plex');
const { setFlash } = require('../middleware/auth');

const router = express.Router();

// Connection status + libraries
router.get('/', async (req, res) => {
  const status = await plex.status();
  let libs = [];
  let libError = null;
  if (status.online) {
    try { libs = await plex.libraries(); } catch (e) { libError = e.message; }
  }
  const linked = (await db.get('SELECT COUNT(*) c FROM titles WHERE plex_rating_key IS NOT NULL')).c;
  res.render('plex', { title: 'Plex', status, libs, libError, linked });
});

// Import / refresh every item in a Plex library
router.post('/sync/:key', async (req, res) => {
  try {
    const items = await plex.libraryItems(req.params.key);
    const FIND = 'SELECT id FROM titles WHERE plex_rating_key = ?';
    // An existing, unlinked CineBase record for the same title/year/type gets linked instead of duplicated
    const MATCH = `SELECT id FROM titles WHERE plex_rating_key IS NULL AND type = ?
      AND lower(title) = lower(?) AND release_year BETWEEN ? - 1 AND ? + 1 ORDER BY id LIMIT 1`;
    const LINK = 'UPDATE titles SET plex_rating_key = ? WHERE id = ?';
    const INSERT = `INSERT INTO titles (title,type,genre,language,release_year,director,cast_members,seasons,duration_min,rating,platform,status,synopsis,poster_url,backdrop_url,plex_rating_key)
      VALUES (@title,@type,@genre,@language,@release_year,@director,@cast_members,@seasons,@duration_min,@rating,@platform,@status,@synopsis,@poster_url,@backdrop_url,@plex_rating_key)`;
    // On refresh keep manual edits to genre/language/status/platform; update what Plex owns
    const UPDATE = `UPDATE titles SET title=@title, release_year=@release_year, director=COALESCE(@director,director),
      cast_members=COALESCE(@cast_members,cast_members), seasons=@seasons, duration_min=@duration_min, rating=COALESCE(@rating,rating),
      synopsis=COALESCE(@synopsis,synopsis), poster_url=COALESCE(poster_url,@poster_url), backdrop_url=COALESCE(backdrop_url,@backdrop_url),
      updated_at=datetime('now') WHERE plex_rating_key=@plex_rating_key`;
    let added = 0, updated = 0, linked = 0;
    await db.transaction(async tx => {
      for (const it of items) {
        const wasLinked = !!(await tx.get(FIND, it.plex_rating_key));
        if (!wasLinked) {
          const existing = await tx.get(MATCH, it.type, it.title, it.release_year, it.release_year);
          if (!existing) { await tx.run(INSERT, it); added++; continue; }
          await tx.run(LINK, it.plex_rating_key, existing.id);
          linked++;
        }
        const { type, genre, language, platform, status, ...rest } = it;
        await tx.run(UPDATE, rest);
        if (wasLinked) updated++;
      }
    });
    setFlash(req, 'success', `Plex sync complete: ${added} added, ${linked} linked to existing titles, ${updated} refreshed.`);
  } catch (e) {
    setFlash(req, 'error', `Plex sync failed: ${e.message}`);
  }
  res.redirect('/plex');
});

module.exports = router;
