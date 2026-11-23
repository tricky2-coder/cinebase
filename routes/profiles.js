const express = require('express');
const db = require('../db');
const { requireUser } = require('../middleware/auth');

const router = express.Router();
router.use(requireUser);

const AVATAR_PRESETS = [
  { id: 'alien', name: 'Alien', path: '/profiles/avatars/alien.svg' },
  { id: 'blue-classic-icon', name: 'Blue Classic Icon', path: '/profiles/avatars/blue-classic-icon.svg' },
  { id: 'chicken', name: 'Chicken', path: '/profiles/avatars/chicken.svg' },
  { id: 'dark-grey-smile', name: 'Dark Grey Smile', path: '/profiles/avatars/dark-grey-smile.svg' },
  { id: 'dog', name: 'Dog', path: '/profiles/avatars/dog.svg' },
  { id: 'dusty-chilleez', name: 'Dusty Chilleez', path: '/profiles/avatars/dusty-chilleez.svg' },
  { id: 'eyepatch', name: 'Eyepatch', path: '/profiles/avatars/eyepatch.svg' },
  { id: 'green-smile', name: 'Green Smile', path: '/profiles/avatars/green-smile.svg' },
  { id: 'helmet', name: 'Helmet', path: '/profiles/avatars/helmet.svg' },
  { id: 'moustache', name: 'Moustache', path: '/profiles/avatars/moustache.svg' },
  { id: 'mummy', name: 'Mummy', path: '/profiles/avatars/mummy.svg' },
  { id: 'pink-giggle', name: 'Pink Giggle', path: '/profiles/avatars/pink-giggle.svg' },
  { id: 'pink-smile', name: 'Pink Smile', path: '/profiles/avatars/pink-smile.svg' },
  { id: 'purple-penguin', name: 'Purple Penguin', path: '/profiles/avatars/purple-penguin.svg' },
  { id: 'purple-smile', name: 'Purple Smile', path: '/profiles/avatars/purple-smile.svg' },
  { id: 'purple-superhero', name: 'Purple Superhero', path: '/profiles/avatars/purple-superhero.svg' },
  { id: 'red-smile', name: 'Red Smile', path: '/profiles/avatars/red-smile.svg' },
  { id: 'robin-chilleez', name: 'Robin Chilleez', path: '/profiles/avatars/robin-chilleez.svg' },
  { id: 'robot', name: 'Robot', path: '/profiles/avatars/robot.svg' },
  { id: 'scarlet-chilleez', name: 'Scarlet Chilleez', path: '/profiles/avatars/scarlet-chilleez.svg' },
  { id: 'sunny-chilleez', name: 'Sunny Chilleez', path: '/profiles/avatars/sunny-chilleez.svg' },
  { id: 'yellow-smile', name: 'Yellow Smile', path: '/profiles/avatars/yellow-smile.svg' },
  { id: 'red-superhero', name: 'Red Superhero', path: '/profiles/avatars/red-superhero.svg' }
];

// "Who's Watching?" route
router.get('/whos-watching', (req, res) => {
  const dest = req.query.next || '/';
  const redirectUrl = `${dest}${dest.includes('?') ? '&' : '?'}whosWatching=1`;
  res.redirect(redirectUrl);
});

// List profiles
router.get('/api/profiles', async (req, res) => {
  try {
    const profiles = await db.all('SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC', req.session.user.id);
    res.json({
      profiles,
      activeProfileId: req.session.activeProfileId,
      presets: AVATAR_PRESETS
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create profile
router.post('/api/profiles', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validPaths = AVATAR_PRESETS.map(p => p.path);
    const avatar = validPaths.includes(req.body.avatar) ? req.body.avatar : AVATAR_PRESETS[1].path; // default blue classic icon
    const isKids = req.body.is_kids ? 1 : 0;
    
    // Check limit (e.g. max 6 profiles)
    const count = (await db.get('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?', req.session.user.id)).c;
    if (count >= 6) return res.status(400).json({ error: 'Maximum 6 profiles allowed' });

    const r = await db.run(
      'INSERT INTO profiles (user_id, name, avatar, is_kids) VALUES (?, ?, ?, ?)',
      req.session.user.id, name, avatar, isKids
    );
    const newProfile = { id: r.lastInsertRowid, user_id: req.session.user.id, name, avatar, is_kids: isKids };
    res.status(201).json(newProfile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Switch active profile
router.post('/api/profiles/:id/switch', async (req, res) => {
  try {
    const profile = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    req.session.activeProfileId = profile.id;
    req.session.activeProfile = profile;
    res.json({ success: true, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update profile
router.put('/api/profiles/:id', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const avatar = req.body.avatar || AVATAR_PRESETS[0].path;
    const isKids = req.body.is_kids ? 1 : 0;

    await db.run(
      'UPDATE profiles SET name = ?, avatar = ?, is_kids = ? WHERE id = ? AND user_id = ?',
      name, avatar, isKids, req.params.id, req.session.user.id
    );
    const updated = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (req.session.activeProfileId === Number(req.params.id)) {
      req.session.activeProfile = updated;
    }
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete profile
router.delete('/api/profiles/:id', async (req, res) => {
  try {
    const count = (await db.get('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?', req.session.user.id)).c;
    if (count <= 1) return res.status(400).json({ error: 'Cannot delete the only profile' });

    await db.run('DELETE FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (req.session.activeProfileId === Number(req.params.id)) {
      const first = await db.get('SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1', req.session.user.id);
      req.session.activeProfileId = first.id;
      req.session.activeProfile = first;
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WATCHLIST API
router.get('/api/watchlist', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    const items = await db.all('SELECT * FROM watchlists WHERE profile_id = ? ORDER BY id DESC', profileId);
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/watchlist', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    const { media_type, media_id, title, poster_url, release_year, rating, href } = req.body;
    if (!media_type || !media_id || !title || !href) {
      return res.status(400).json({ error: 'Missing required media fields' });
    }
    // Check if exists
    const exists = await db.get(
      'SELECT id FROM watchlists WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, media_type, String(media_id)
    );
    if (exists) {
      await db.run('DELETE FROM watchlists WHERE id = ?', exists.id);
      return res.json({ saved: false });
    }
    await db.run(
      `INSERT INTO watchlists (profile_id, user_id, media_type, media_id, title, poster_url, release_year, rating, href)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      profileId, req.session.user.id, media_type, String(media_id), title, poster_url, release_year, rating, href
    );
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/watchlist/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM watchlists WHERE id = ? AND profile_id = ?', req.params.id, req.session.activeProfileId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WATCHLIST PAGE
router.get('/watchlist', async (req, res) => {
  const profileId = req.session.activeProfileId;
  const items = await db.all('SELECT * FROM watchlists WHERE profile_id = ? ORDER BY id DESC', profileId);
  res.render('site/browse', {
    title: 'Watchlist',
    heading: 'Your Watchlist',
    items: items.map(i => ({ ...i, type: i.media_type === 'movie' ? 'Movie' : (i.media_type === 'anime' ? 'Anime' : 'Series') })),
    total: items.length,
    page: 1,
    pages: 1,
    qs: '',
    genres: [],
    languages: [],
    query: {},
    sort: 'new',
    q: ''
  });
});

// WATCH HISTORY API & PAGE
router.get('/api/history', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    const items = await db.all('SELECT * FROM watch_history WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 50', profileId);
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/history', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    const { media_type, media_id, title, poster_url, href, season, episode, progress_seconds, duration_seconds } = req.body;
    if (!media_type || !media_id || !title || !href) {
      return res.status(400).json({ error: 'Missing required media fields' });
    }
    const exists = await db.get(
      'SELECT id FROM watch_history WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, media_type, String(media_id)
    );
    if (exists) {
      await db.run(
        `UPDATE watch_history SET season = ?, episode = ?, progress_seconds = ?, duration_seconds = ?, updated_at = datetime('now')
         WHERE id = ?`,
        season || null, episode || null, progress_seconds || 0, duration_seconds || 0, exists.id
      );
    } else {
      await db.run(
        `INSERT INTO watch_history (profile_id, user_id, media_type, media_id, title, poster_url, href, season, episode, progress_seconds, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profileId, req.session.user.id, media_type, String(media_id), title, poster_url, href, season || null, episode || null, progress_seconds || 0, duration_seconds || 0
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/history', async (req, res) => {
  const profileId = req.session.activeProfileId;
  const items = await db.all('SELECT * FROM watch_history WHERE profile_id = ? ORDER BY updated_at DESC', profileId);
  res.render('site/browse', {
    title: 'Watch History',
    heading: 'Watch History',
    items: items.map(i => ({ ...i, type: i.media_type === 'movie' ? 'Movie' : (i.media_type === 'anime' ? 'Anime' : 'Series') })),
    total: items.length,
    page: 1,
    pages: 1,
    qs: '',
    genres: [],
    languages: [],
    query: {},
    sort: 'new',
    q: ''
  });
});

module.exports = router;