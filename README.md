# 🎬 CineBase — Movie / Series Database System

A web application that replaces Excel-sheet record keeping for a movie & series catalogue. It runs in the browser, so the admin can work from any laptop, desktop or mobile once it is deployed to the internet.

**Stack:** Node.js · Express 5 · EJS (server-rendered views) · SQLite (built-in `node:sqlite`, no native build) · bcrypt password hashing · session-based auth

---

## ✨ Features

### Authentication (roles: admin, user)
- Everyone signs in with username + password; the whole site (including the movie pages) requires an account.
- **Wrong credentials →** stays on the login page with the message **"Wrong credentials"**.
- **Correct credentials →** admins go to the **Dashboard**, users go to the movie site (or the page they were trying to open).
- Every page except login is protected; un-authenticated visits are redirected to `/login`.
- **user** accounts can only watch and browse; the dashboard and all admin pages are **admin**-only.
- Accounts are created by an admin on the *Users* page (no public sign-up). Deleting a user or changing their role takes effect immediately.
- Passwords are stored as bcrypt hashes; sessions are HTTP-only cookies.

### Movies & Series — full CRUDL
| Operation | How |
|---|---|
| **C**reate | *+ Add Title* — title, type (Movie/Series), genre, language, year, rating, director, cast, seasons, duration, platform, status, synopsis |
| **R**ead | Click any title to open its detail page |
| **U**pdate | *Edit* button on list or detail page |
| **D**elete | *Delete* button (with confirmation) |
| **L**ist | Paginated table, 10 per page |
| **Search** | Free-text search across title, director, cast and synopsis + filters for type, genre, language, status, year range, minimum rating + sorting |
| **Export** | *Export CSV* downloads the current search result — opens directly in Excel |

### Users — full CRUDL
- Admin sees the **users list** and can add, edit, delete and search users (by name / username / email, filter by role).
- Safety rules: you can't delete yourself, and the last admin can't be deleted or demoted.
- Give friends and family the `user` role so they can watch without access to the admin panel.

### Public site (streaming-style frontend)
- **Every movie & series (with `TMDB_API_KEY`):** the public site reads the live TMDB catalogue.
  - **Home:** Trending, Popular and Top Rated rows for movies and series, plus your own CineBase and Plex rows.
  - **Movies / Series:** discover the whole catalogue with genre, language, year and sort filters (paged).
  - **Search:** finds any title on TMDB; matches from your own CineBase are listed first.
  - **Title pages** (`/m/:id`, `/tv/:id`): backdrop, cast, trailer, player and recommendations for any TMDB title.
  - Logged-in admins get **+ Add to CineBase** on any title page to save it into the catalogue in one click.
  - TMDB responses are cached in memory for a few hours.
- **My CineBase** (`/browse`): your own catalogue with type, genre, language and sort filters. Without a TMDB key, the whole site shows only this catalogue.
- **Title page:** backdrop, poster, cast, trailer (YouTube, privacy mode), "More like this", a **▶ Play on Plex** button for titles on your server, and an embedded player with a **Player** menu: VidSrc mirrors or [Vidy](https://www.vidy.st) (choice remembered per browser). With Vidy, playback resumes where you stopped and series continue to the next episode automatically. Series get season tabs and episode cards from TMDB (thumbnail, title, runtime; unaired episodes greyed out), Prev/Next across seasons, and resume where each viewer left off.
- Signing in is required to browse; editing stays admin-only.
### Plex Media Server integration
- Admin → **Plex** shows connection status and your movie and TV libraries.
- **Sync library** imports every item with its poster, backdrop, cast, runtime and rating. Re-syncing refreshes items without duplicating them, and existing CineBase titles with the same name and year get linked instead of copied.
- Linked titles open in Plex Web on any device signed into your Plex account.
- Your `PLEX_TOKEN` never reaches the browser. Artwork is proxied through the CineBase server.

### TMDB integration (optional)
- **Auto-fill** on the add/edit form: search TMDB, pick a result, and title, poster, backdrop, cast, director, runtime, rating, trailer and Indian streaming provider are filled in.
- **Fetch posters (TMDB)** on the titles list fills missing artwork and trailers for the whole catalogue.

### Dashboard
Totals (titles, movies, series, users, average rating), top-rated titles, genre breakdown and recently updated records.

### Responsive
Works on mobile — collapsible navigation, and tables turn into stacked cards on small screens.

---

## 🚀 Run locally

**Requirements:** Node.js 22.13 or newer.

```bash
git clone https://github.com/<your-username>/cinebase.git
cd cinebase
npm install
npm start
```

Public site: **http://localhost:3000** · Admin: **http://localhost:3000/admin**

### Default login
| Username | Password |
|---|---|
| `admin` | `admin123` |

> Change these with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables **before the first run** (the admin is created only when the database is first set up). After that, change the password from the *Users* page.

On first start the app creates `data/cinebase.db` and seeds 8 sample titles.

### Import titles from OMDb
Set `OMDB_API_KEY` in `.env`, then:
```bash
npm run import:omdb                                   # curated list of popular titles
npm run import:omdb -- --ids tt0133093 tt0110912      # specific IMDb IDs
npm run import:omdb -- --search Batman "Star Wars"    # search results
```
Existing titles (same IMDb ID, or same title/type/year) are updated in place: missing fields are filled and the rating refreshed; Plex links, trailers and manual edits are kept.

---

## ⚙️ Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `SESSION_SECRET` | random per start | Secret for signing session cookies — **set this in production** |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password |
| `DATA_DIR` | `./data` | Folder for the SQLite database file |
| `NODE_ENV` | — | Set to `production` to enable secure (HTTPS-only) cookies |
| `PLEX_URL` | — | Plex server address, e.g. `http://192.168.1.50:32400` |
| `PLEX_TOKEN` | — | Your X-Plex-Token |
| `TMDB_API_KEY` | — | TMDB v3 API key or v4 read token |
| `OMDB_API_KEY` | — | OMDb key, used by `npm run import:omdb` |
| `VIDSRC_DOMAINS` | `vidsrc.pm,vidsrc.cc` | Player mirrors, comma-separated; the first is the default |
| `VIDY` | `1` | `0` hides the Vidy player option |
| `VIDSRC_SANDBOX` | `0` | `1` sandboxes the player iframe (blocks popups/redirects; some mirrors won't play) |

In production (`NODE_ENV=production`) the server refuses to start without `SESSION_SECRET`, and refuses to create the first admin with the default `admin123` password.

Copy `.env.example` to `.env` and edit it. `npm start` loads it automatically.

---

## 🏠 Running on a home server with Plex

1. Install Node.js 22 LTS on the machine that runs Plex (or any machine on the same network).
2. `npm install`, then copy `.env.example` to `.env`.
3. Set `PLEX_URL=http://127.0.0.1:32400` if CineBase runs on the Plex machine; otherwise use that machine's LAN IP.
4. Get your token: in Plex Web open any item → ⋯ → **Get Info** → **View XML**. Copy the `X-Plex-Token=` value from the URL into `PLEX_TOKEN`.
5. `npm start`, open `http://<server-ip>:3000` from any device on your Wi-Fi, log in, go to **Plex → Sync library**.
6. **Away from home:** install [Tailscale](https://tailscale.com) on the server and your phone/laptop and open `http://<tailscale-ip>:3000`. Don't port-forward the admin panel to the open internet.
7. **Keep it running** after reboots: `npm i -g pm2 && pm2 start npm --name cinebase -- start && pm2 save`. On Linux also run `pm2 startup`. On Windows use `pm2-windows-startup`.

---

## 🌐 Deploy to the internet (Render)

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo (or use **New → Blueprint**, which reads `render.yaml`).
3. Build command: `npm install` · Start command: `npm start`
4. Add environment variables: `NODE_ENV=production`, `SESSION_SECRET=<long random string>`, `ADMIN_PASSWORD=<your password>`.
5. Deploy — you get a public URL like `https://cinebase.onrender.com`.

> **Note on data persistence:** Render's free tier has an ephemeral disk, so the SQLite file resets on every redeploy/restart. For permanent data, attach a persistent disk (paid) and set `DATA_DIR` to its mount path, or deploy on Railway with a volume.

---

## 📁 Project structure

```
cinebase/
├── server.js              # App setup, sessions, dashboard route
├── db.js                  # SQLite schema + seed data
├── middleware/
│   └── auth.js            # Login guard + flash helper
├── routes/
│   ├── auth.js            # /login (rate-limited), /logout
│   ├── dashboard.js       # Admin dashboard
│   ├── titles.js          # Movies & series CRUDL, search, CSV export
│   ├── users.js           # Users CRUDL + search
│   ├── plex.js            # Plex status + library sync (admin)
│   └── site.js            # Public frontend + Plex play/artwork proxy
├── services/
│   ├── plex.js            # Plex Media Server API client
│   ├── tmdb.js            # TMDB API client
│   ├── vidsrc.js          # VidSrc player config (mirrors, embed URLs)
│   └── session-store.js   # SQLite session store (sessions survive restarts)
├── scripts/
│   └── import-omdb.js     # OMDb catalogue importer
├── views/                 # EJS templates
│   ├── partials/          # header / footer
│   ├── titles/            # index, form, show
│   ├── users/             # index, form
│   ├── site/              # public home, browse, detail
│   ├── plex.ejs
│   ├── login.ejs
│   ├── dashboard.ejs
│   └── error.ejs
├── public/css/            # style.css (admin), site.css (public)
├── public/js/             # admin.js, title-form.js, site.js (no inline scripts, for the CSP)
├── render.yaml            # One-click Render deployment
└── package.json
```

## 🗄️ Database schema

**users** — `id, name, username (unique), email (unique), password (bcrypt), role (admin|user), created_at`

**titles** — `id, title, type (Movie|Series), genre, language, release_year, director, cast_members, seasons, duration_min, rating (0–10), platform, status (Released|Ongoing|Upcoming|Ended), synopsis, poster_url, backdrop_url, trailer_key, tmdb_id, plex_rating_key, created_at, updated_at`

Existing databases are upgraded automatically on start (new columns are added in place).

---

## 🔒 Security notes
- Parameterised SQL queries everywhere (no SQL injection).
- EJS escapes all output (no stored XSS).
- Session ID is regenerated on login; cookies are `httpOnly` + `sameSite=lax`.
- Server-side validation on every form, not just browser checks.
- Login is rate-limited (10 failed attempts per 15 minutes per IP) and doesn't leak which usernames exist.
- Security headers via `helmet`, including a Content Security Policy that only allows the site's own scripts.
- Sessions are stored in SQLite, so they survive restarts.



## 📄 License
MIT
