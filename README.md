# 🎬 CineBase — Movie / Series Database System

A web application that replaces Excel-sheet record keeping for a movie & series catalogue. It runs in the browser, so the admin can work from any laptop, desktop or mobile once it is deployed to the internet.

**Stack:** Node.js · Express 5 · EJS (server-rendered views) · SQLite (`better-sqlite3`) · bcrypt password hashing · session-based auth

---

## ✨ Features

### Authentication (Role: Admin)
- Admin logs in with username + password.
- **Wrong credentials →** stays on the login page with the message **"Wrong credentials"**.
- **Correct credentials →** redirected to the **Dashboard**.
- Every page except login is protected; un-authenticated visits are redirected to `/login`.
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
- Only users with role `admin` can log in to the panel.

### Dashboard
Totals (titles, movies, series, users, average rating), top-rated titles, genre breakdown and recently updated records.

### Responsive
Works on mobile — collapsible navigation, and tables turn into stacked cards on small screens.

---

## 🚀 Run locally

**Requirements:** Node.js 20 or newer.

```bash
git clone https://github.com/<your-username>/cinebase.git
cd cinebase
npm install
npm start
```

Open **http://localhost:3000**

### Default login
| Username | Password |
|---|---|
| `admin` | `admin123` |

> Change these with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables **before the first run** (the admin is created only when the database is first set up). After that, change the password from the *Users* page.

On first start the app creates `data/cinebase.db` and seeds 8 sample titles.

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

See `.env.example`.

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
│   ├── auth.js            # /login, /logout
│   ├── titles.js          # Movies & series CRUDL, search, CSV export
│   └── users.js           # Users CRUDL + search
├── views/                 # EJS templates
│   ├── partials/          # header / footer
│   ├── titles/            # index, form, show
│   ├── users/             # index, form
│   ├── login.ejs
│   ├── dashboard.ejs
│   └── error.ejs
├── public/css/style.css
├── render.yaml            # One-click Render deployment
└── package.json
```

## 🗄️ Database schema

**users** — `id, name, username (unique), email (unique), password (bcrypt), role (admin|user), created_at`

**titles** — `id, title, type (Movie|Series), genre, language, release_year, director, cast_members, seasons, duration_min, rating (0–10), platform, status (Released|Ongoing|Upcoming|Ended), synopsis, created_at, updated_at`

---

## 🔒 Security notes
- Parameterised SQL queries everywhere (no SQL injection).
- EJS escapes all output (no stored XSS).
- Session ID is regenerated on login; cookies are `httpOnly` + `sameSite=lax`.
- Server-side validation on every form, not just browser checks.

## 👤 Author
**Aneesh Ajay Deokar** — E&CS, Thakur College of Engineering and Technology

## 📄 License
MIT
