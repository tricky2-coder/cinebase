const express = require('express');
const bcrypt = require('bcryptjs');
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
    const profiles = await db.all('SELECT id, user_id, name, avatar, is_kids, (pin IS NOT NULL) AS has_pin, created_at FROM profiles WHERE user_id = ? ORDER BY id ASC', req.session.user.id);
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
    if (req.session.activeProfile && req.session.activeProfile.is_kids) {
      return res.status(403).json({ error: 'Kids profiles cannot manage or create profiles.' });
    }
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validPaths = AVATAR_PRESETS.map(p => p.path);
    const avatar = validPaths.includes(req.body.avatar) ? req.body.avatar : AVATAR_PRESETS[1].path; // default blue classic icon
    const isKids = req.body.is_kids ? 1 : 0;

    let pin = null;
    if (req.body.pin && /^\d{4}$/.test(String(req.body.pin).trim())) {
      pin = bcrypt.hashSync(String(req.body.pin).trim(), 10);
    }
    
    // Check limit (e.g. max 6 profiles)
    const count = (await db.get('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?', req.session.user.id)).c;
    if (count >= 6) return res.status(400).json({ error: 'Maximum 6 profiles allowed' });

    // If creating a kids profile, require at least one locked adult profile
    if (isKids) {
      const hasLockedAdult = await db.get(
        'SELECT id FROM profiles WHERE user_id = ? AND is_kids = 0 AND pin IS NOT NULL LIMIT 1',
        req.session.user.id
      );
      if (!hasLockedAdult) {
        return res.status(400).json({ error: 'An adult profile must have a PIN lock first before creating a Kids profile.' });
      }
    }

    const r = await db.run(
      'INSERT INTO profiles (user_id, name, avatar, is_kids, pin) VALUES (?, ?, ?, ?, ?)',
      req.session.user.id, name, avatar, isKids, pin
    );
    const newProfile = { id: r.lastInsertRowid, user_id: req.session.user.id, name, avatar, is_kids: isKids, has_pin: Boolean(pin) };
    res.status(201).json(newProfile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Switch active profile (with PIN validation if locked or when exiting kids)
router.post('/api/profiles/:id/switch', async (req, res) => {
  try {
    const profile = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const currentActive = req.session.activeProfile;
    const isExitingKids = currentActive && currentActive.is_kids && !profile.is_kids;

    // If profile has a PIN lock, verify PIN
    if (profile.pin) {
      const inputPin = (req.body.pin || '').toString().trim();
      if (!inputPin) {
        return res.status(403).json({ error: 'PIN required', pinRequired: true });
      }
      const ok = bcrypt.compareSync(inputPin, profile.pin);
      if (!ok) {
        return res.status(401).json({ error: 'Incorrect PIN', incorrectPin: true });
      }
    } else if (isExitingKids) {
      // Switching out of a Kids profile to an adult profile requires adult PIN
      const inputPin = (req.body.pin || '').toString().trim();
      if (!inputPin) {
        return res.status(403).json({ error: 'Adult PIN required to exit Kids profile', pinRequired: true });
      }
      let adultWithPin = null;
      if (req.body.authProfileId) {
        adultWithPin = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ? AND pin IS NOT NULL', req.body.authProfileId, req.session.user.id);
      }
      if (!adultWithPin) {
        adultWithPin = await db.get('SELECT * FROM profiles WHERE user_id = ? AND is_kids = 0 AND pin IS NOT NULL LIMIT 1', req.session.user.id);
      }
      if (adultWithPin && adultWithPin.pin) {
        const ok = bcrypt.compareSync(inputPin, adultWithPin.pin);
        if (!ok) {
          return res.status(401).json({ error: 'Incorrect PIN', incorrectPin: true });
        }
      }
    }

    req.session.activeProfileId = profile.id;
    req.session.activeProfile = {
      id: profile.id,
      user_id: profile.user_id,
      name: profile.name,
      avatar: profile.avatar,
      is_kids: profile.is_kids,
      has_pin: Boolean(profile.pin)
    };
    res.json({ success: true, profile: req.session.activeProfile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update profile
router.put('/api/profiles/:id', async (req, res) => {
  try {
    if (req.session.activeProfile && req.session.activeProfile.is_kids) {
      return res.status(403).json({ error: 'Kids profiles cannot manage or edit profiles.' });
    }
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const avatar = req.body.avatar || AVATAR_PRESETS[0].path;
    const isKids = req.body.is_kids ? 1 : 0;
    const current = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (!current) return res.status(404).json({ error: 'Profile not found' });

    // If enabling a kids profile, require at least one locked adult profile
    if (isKids) {
      const hasLockedAdult = await db.get(
        'SELECT id FROM profiles WHERE user_id = ? AND id != ? AND is_kids = 0 AND pin IS NOT NULL LIMIT 1',
        req.session.user.id, req.params.id
      );
      if (!hasLockedAdult) {
        return res.status(400).json({ error: 'An adult profile must have a PIN lock first before enabling a Kids profile.' });
      }
    }

    let pin = current.pin;
    const wantsToRemovePin = (req.body.remove_pin === true || req.body.remove_pin === 'true' || req.body.lock_pin === false);
    const wantsToSetNewPin = (req.body.pin && /^\d{4}$/.test(String(req.body.pin).trim()));

    // If profile already has a PIN, changing or removing it is strictly restricted:
    // 1. Only the profile itself (when active) can change or remove its PIN
    // 2. Must provide the correct current (old) PIN
    if (current.pin && (wantsToRemovePin || wantsToSetNewPin)) {
      if (Number(req.session.activeProfileId) !== current.id) {
        return res.status(403).json({
          error: 'Only this profile can change or turn off its PIN lock. Please switch to this profile first.'
        });
      }

      const oldPin = (req.body.old_pin || '').toString().trim();
      if (!oldPin) {
        return res.status(400).json({ error: 'Current PIN is required to change or turn off the PIN lock.' });
      }
      const match = bcrypt.compareSync(oldPin, current.pin);
      if (!match) {
        return res.status(401).json({ error: 'Incorrect current PIN. Please enter your existing PIN.' });
      }
    }

    if (wantsToRemovePin) {
      pin = null;
    } else if (wantsToSetNewPin) {
      pin = bcrypt.hashSync(String(req.body.pin).trim(), 10);
    }

    // If this profile was a locked adult, check if changes would leave kids profile unprotected
    const willBeLockedAdult = (!isKids && Boolean(pin));
    if (current.pin && !current.is_kids && !willBeLockedAdult) {
      const hasKids = await db.get('SELECT id FROM profiles WHERE user_id = ? AND is_kids = 1 LIMIT 1', req.session.user.id);
      if (hasKids) {
        const otherLockedAdult = await db.get(
          'SELECT id FROM profiles WHERE user_id = ? AND id != ? AND is_kids = 0 AND pin IS NOT NULL LIMIT 1',
          req.session.user.id, req.params.id
        );
        if (!otherLockedAdult) {
          return res.status(400).json({ error: 'Cannot remove PIN lock: at least one adult profile must remain locked with a PIN while a Kids profile exists.' });
        }
      }
    }

    await db.run(
      'UPDATE profiles SET name = ?, avatar = ?, is_kids = ?, pin = ? WHERE id = ? AND user_id = ?',
      name, avatar, isKids, pin, req.params.id, req.session.user.id
    );
    const updated = await db.get('SELECT id, user_id, name, avatar, is_kids, (pin IS NOT NULL) AS has_pin, created_at FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
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
    if (req.session.activeProfile && req.session.activeProfile.is_kids) {
      return res.status(403).json({ error: 'Kids profiles cannot delete profiles.' });
    }
    const count = (await db.get('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?', req.session.user.id)).c;
    if (count <= 1) return res.status(400).json({ error: 'Cannot delete the only profile' });

    const current = await db.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', req.params.id, req.session.user.id);
    if (!current) return res.status(404).json({ error: 'Profile not found' });

    if (current.pin && Number(req.session.activeProfileId) !== current.id) {
      return res.status(403).json({ error: 'Only this profile can delete itself when locked with a PIN. Please switch to this profile first.' });
    }

    if (current.pin && !current.is_kids) {
      const hasKids = await db.get('SELECT id FROM profiles WHERE user_id = ? AND is_kids = 1 LIMIT 1', req.session.user.id);
      if (hasKids) {
        const otherLockedAdult = await db.get(
          'SELECT id FROM profiles WHERE user_id = ? AND id != ? AND is_kids = 0 AND pin IS NOT NULL LIMIT 1',
          req.session.user.id, req.params.id
        );
        if (!otherLockedAdult) {
          return res.status(400).json({ error: 'Cannot delete this profile: at least one locked adult profile is required while a Kids profile exists.' });
        }
      }
    }

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

// Check if a specific title is in the active profile's watchlist
router.get('/api/watchlist/status/:mediaType/:mediaId', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    if (!profileId) return res.json({ inWatchlist: false });
    const row = await db.get(
      'SELECT id FROM watchlists WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, req.params.mediaType, String(req.params.mediaId)
    );
    res.json({ inWatchlist: Boolean(row) });
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
    // Check if exists -> toggle delete/insert
    const exists = await db.get(
      'SELECT id FROM watchlists WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, media_type, String(media_id)
    );
    if (exists) {
      await db.run('DELETE FROM watchlists WHERE id = ?', exists.id);
      return res.json({ saved: false, inWatchlist: false });
    }
    await db.run(
      `INSERT INTO watchlists (profile_id, user_id, media_type, media_id, title, poster_url, release_year, rating, href)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      profileId, req.session.user.id, media_type, String(media_id), title, poster_url, release_year, rating, href
    );
    res.json({ saved: true, inWatchlist: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/watchlist/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM watchlists WHERE id = ? AND profile_id = ?', req.params.id, req.session.activeProfileId);
    res.json({ success: true, inWatchlist: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/watchlist/:mediaType/:mediaId', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    await db.run(
      'DELETE FROM watchlists WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, req.params.mediaType, String(req.params.mediaId)
    );
    res.json({ success: true, inWatchlist: false });
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

// Get watch progress for a specific title
router.get('/api/history/progress/:mediaType/:mediaId', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    if (!profileId) return res.json({ progress: null });
    const row = await db.get(
      'SELECT season, episode, progress_seconds, duration_seconds, updated_at FROM watch_history WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, req.params.mediaType, String(req.params.mediaId)
    );
    res.json({ progress: row || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/history', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    if (!profileId) return res.status(401).json({ error: 'No active profile' });
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
        `UPDATE watch_history SET title = ?, poster_url = ?, href = ?, season = ?, episode = ?, progress_seconds = ?, duration_seconds = ?, updated_at = datetime('now')
         WHERE id = ?`,
        title, poster_url || '', href, season || null, episode || null, progress_seconds || 0, duration_seconds || 0, exists.id
      );
    } else {
      await db.run(
        `INSERT INTO watch_history (profile_id, user_id, media_type, media_id, title, poster_url, href, season, episode, progress_seconds, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profileId, req.session.user.id, media_type, String(media_id), title, poster_url || '', href, season || null, episode || null, progress_seconds || 0, duration_seconds || 0
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/history/:mediaType/:mediaId', async (req, res) => {
  try {
    const profileId = req.session.activeProfileId;
    await db.run(
      'DELETE FROM watch_history WHERE profile_id = ? AND media_type = ? AND media_id = ?',
      profileId, req.params.mediaType, String(req.params.mediaId)
    );
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