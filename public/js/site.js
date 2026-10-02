// Public site behaviour. Wrapped in a function: a global `const top` would clash with window.top.
(() => {
  // Header turns solid on scroll
  const header = document.getElementById('s-top');
  const onScroll = () => header.classList.toggle('solid', scrollY > 30);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Row arrows
  document.querySelectorAll('.row').forEach(row => {
    const track = row.querySelector('.track');
    row.querySelectorAll('.arrow').forEach(b => b.addEventListener('click', () =>
      track.scrollBy({ left: (b.dataset.dir === 'r' ? 1 : -1) * track.clientWidth * 0.85, behavior: 'smooth' })));
  });

  // Browse filters submit on change
  document.querySelectorAll('.filterbar select').forEach(s => s.addEventListener('change', () => s.form.submit()));

  // Hero carousel
  const slides = [...document.querySelectorAll('.slide')], dots = [...document.querySelectorAll('.dots button')];
  if (slides.length > 1) {
    let i = 0, timer;
    const go = n => { slides[i].classList.remove('on'); dots[i].classList.remove('on'); i = (n + slides.length) % slides.length; slides[i].classList.add('on'); dots[i].classList.add('on'); };
    const start = () => { clearInterval(timer); timer = setInterval(() => go(i + 1), 7000); };
    dots.forEach(d => d.addEventListener('click', () => { go(+d.dataset.i); start(); }));
    start();
  }

  // Trailer modal (privacy-enhanced YouTube embed)
  const modal = document.getElementById('trailer-modal'), frame = modal.querySelector('.modal-frame');
  const close = () => { modal.hidden = true; frame.innerHTML = ''; document.body.style.overflow = ''; };
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-trailer]');
    if (t) {
      e.preventDefault();
      frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.dataset.trailer)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="Trailer"></iframe>`;
      modal.hidden = false; document.body.style.overflow = 'hidden';
    } else if (e.target === modal || e.target.closest('.modal-x')) close();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  // Live search suggestions: type -> TMDB matches -> click opens the title at its player
  const searchForm = document.querySelector('.s-search[data-suggest]');
  if (searchForm) {
    const input = searchForm.querySelector('input[name="q"]');
    const list = searchForm.querySelector('.s-suggest');
    let items = [], active = -1, timer, ctrl;

    const closeList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const highlight = i => {
      active = i;
      [...list.children].forEach((li, n) => li.classList.toggle('on', n === i));
      input.setAttribute('aria-activedescendant', i >= 0 ? `sg-${i}` : '');
    };
    const render = results => {
      items = results;
      list.replaceChildren(...results.map((r, i) => {
        const li = document.createElement('li');
        li.id = `sg-${i}`;
        li.setAttribute('role', 'option');
        const a = document.createElement('a');
        a.href = r.href;
        if (r.poster) {
          const img = document.createElement('img');
          img.src = r.poster; img.alt = ''; img.loading = 'lazy';
          a.append(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'sg-noimg';
          a.append(ph);
        }
        const text = document.createElement('span');
        const b = document.createElement('b'); b.textContent = r.title;
        const small = document.createElement('small'); small.textContent = [r.year, r.type].filter(Boolean).join(' · ');
        text.append(b, small);
        const play = document.createElement('span'); play.className = 'sg-play'; play.textContent = '▶';
        a.append(text, play);
        li.append(a);
        li.addEventListener('mouseenter', () => highlight(i));
        return li;
      }));
      list.hidden = !results.length;
      input.setAttribute('aria-expanded', String(!!results.length));
      highlight(-1);
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { ctrl?.abort(); closeList(); return; }
      timer = setTimeout(async () => {
        ctrl?.abort();
        ctrl = new AbortController();
        try {
          const r = await fetch(`${searchForm.dataset.suggest}?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          if (r.ok && input.value.trim() === q) render(await r.json());
        } catch {} // aborted or offline: keep the plain search form working
      }, 250);
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = items[active].href; }
      else if (e.key === 'Escape') closeList();
    });
    input.addEventListener('focus', () => { if (list.children.length && input.value.trim().length >= 2) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
    document.addEventListener('click', e => { if (!searchForm.contains(e.target)) closeList(); });
  }

  // VidSrc player: mirror switcher (remembered per browser) + season/episode picker for series
  const player = document.getElementById('player');
  if (player) {
    const cfg = JSON.parse(player.dataset.cfg);
    const iframe = player.querySelector('iframe');
    const mirror = document.getElementById('p-mirror');
    const MIRROR_KEY = 'cinebase.mirror', EP_KEY = `cinebase.ep.${cfg.key}`;
    const state = { s: 1, e: 1 };
    let onEnded = () => {}; // series: continue with the next episode

    // Watch position per movie / episode (players that report playback events, e.g. Vidy)
    const posKey = () => `cinebase.pos.${cfg.key}` + (cfg.isSeries ? `.${state.s}.${state.e}` : '');
    const resumeAt = () => {
      try {
        const p = JSON.parse(localStorage.getItem(posKey()) || 'null');
        return p && p.t > 30 && (!p.d || p.t < p.d - 60) ? Math.floor(p.t) : null;
      } catch { return null; }
    };

    const url = ({ autoplay = false } = {}) => {
      const p = cfg.players[mirror.value];
      if (!p) return iframe.src;
      const u = new URL(`https://${mirror.value}` + p.path
        .replace('{id}', encodeURIComponent(p.id)).replace('{s}', state.s).replace('{e}', state.e));
      if (p.events) {
        const t = resumeAt();
        if (t) u.searchParams.set('progress', t);
        if (autoplay) u.searchParams.set('autoplay', 'true'); // only after a click on this page
      }
      return u.href;
    };
    const load = opts => { const u = url(opts); if (iframe.src !== u) iframe.src = u; };

    // Playback events posted by the player (JSON strings). Only trust our own iframe.
    let lastSaved = 0;
    addEventListener('message', e => {
      if (e.source !== iframe.contentWindow || typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'MEDIA_DATA' || !msg.event) return;
      if (msg.event === 'timeupdate' && Number.isFinite(msg.currentTime) && Math.abs(msg.currentTime - lastSaved) >= 5) {
        lastSaved = msg.currentTime;
        try { localStorage.setItem(posKey(), JSON.stringify({ t: msg.currentTime, d: msg.duration || null })); } catch {}
      } else if (msg.event === 'ended') {
        try { localStorage.removeItem(posKey()); } catch {}
        lastSaved = 0;
        onEnded();
      }
    });

    try {
      const saved = localStorage.getItem(MIRROR_KEY);
      if (saved && [...mirror.options].some(o => o.value === saved)) mirror.value = saved;
    } catch {}
    mirror.addEventListener('change', () => {
      try { localStorage.setItem(MIRROR_KEY, mirror.value); } catch {}
      load({ autoplay: true });
    });

    if (cfg.isSeries) {
      const seasons = cfg.seasons;
      const tabs = [...document.querySelectorAll('.season-tab')];
      const list = document.getElementById('ep-list');
      const now = document.getElementById('ep-now');
      const prev = document.getElementById('ep-prev'), next = document.getElementById('ep-next');
      const cache = {}; // season number -> episodes from TMDB (or null if unavailable)
      let shown = null; // season whose episodes are listed

      const sIdx = s => seasons.findIndex(x => x.n === s);
      const count = s => cache[s]?.length || seasons[sIdx(s)]?.episodes || null;
      const aired = (s, e) => { const ep = cache[s]?.find(x => x.n === e); return !ep || ep.aired; };
      const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

      async function episodes(s) {
        if (s in cache) return cache[s];
        if (!cfg.tvId) return (cache[s] = null);
        try {
          const r = await fetch(`/episodes/${cfg.tvId}/${s}`);
          cache[s] = r.ok ? await r.json() : null;
        } catch { cache[s] = null; }
        return cache[s];
      }

      function card(s, ep) {
        const b = el('button', 'ep-card');
        b.type = 'button';
        b.dataset.e = ep.n;
        if (ep.overview) b.title = ep.overview;
        const thumb = el('span', 'ep-thumb');
        if (ep.still) { const img = el('img'); img.src = ep.still; img.alt = ''; img.loading = 'lazy'; thumb.append(img); }
        thumb.append(el('span', 'ep-badge', `E${ep.n}`), el('span', 'ep-playing', '▶ Playing'));
        const info = el('span', 'ep-info');
        const meta = ep.aired === false
          ? (ep.air_date ? `Airs ${fmtDate(ep.air_date)}` : 'Not aired yet')
          : [ep.runtime && `${ep.runtime} min`, ep.air_date && fmtDate(ep.air_date)].filter(Boolean).join(' · ');
        info.append(el('b', null, ep.name), el('small', null, meta));
        b.append(thumb, info);
        if (ep.aired === false) { b.disabled = true; b.classList.add('upcoming'); }
        else b.addEventListener('click', () => play(s, ep.n));
        return b;
      }

      // Neighbouring episode, crossing into the next/previous season when counts are known
      function step(dir) {
        const total = count(state.s);
        if (dir > 0) {
          if (!total || state.e < total) return aired(state.s, state.e + 1) ? { s: state.s, e: state.e + 1 } : null;
          const ns = seasons[sIdx(state.s) + 1];
          return ns ? { s: ns.n, e: 1 } : null;
        }
        if (state.e > 1) return { s: state.s, e: state.e - 1 };
        const ps = seasons[sIdx(state.s) - 1];
        return ps ? { s: ps.n, e: count(ps.n) || 1 } : null;
      }

      function mark() {
        list.querySelectorAll('.ep-card').forEach(c => {
          const on = shown === state.s && +c.dataset.e === state.e;
          c.classList.toggle('on', on);
          c.setAttribute('aria-current', on ? 'true' : 'false');
          if (on) list.scrollTo({ left: c.offsetLeft - list.offsetLeft - 8, behavior: 'smooth' }); // horizontal only
        });
        const name = cache[state.s]?.find(x => x.n === state.e)?.name;
        now.textContent = `Season ${state.s} · Episode ${state.e}` + (name ? ` — ${name}` : '');
        prev.disabled = !step(-1);
        next.disabled = !step(1);
      }

      async function showSeason(s) {
        shown = s;
        tabs.forEach(t => {
          const on = +t.dataset.season === s;
          t.setAttribute('aria-selected', String(on));
          if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        list.replaceChildren(el('p', 'ep-msg', 'Loading episodes…'));
        const eps = await episodes(s);
        if (shown !== s) return; // switched again while loading
        const items = eps || Array.from({ length: count(s) || 0 }, (_, i) => ({ n: i + 1, name: `Episode ${i + 1}` }));
        list.replaceChildren(...(items.length ? items.map(ep => card(s, ep)) : [el('p', 'ep-msg', 'Episode list unavailable — use Prev / Next.')]));
        mark();
      }

      function play(s, e) {
        state.s = s; state.e = e;
        lastSaved = 0;
        try { localStorage.setItem(EP_KEY, JSON.stringify(state)); } catch {}
        load({ autoplay: true });
        if (shown !== s) showSeason(s); else mark();
      }
      onEnded = () => { const t = step(1); if (t) play(t.s, t.e); };

      tabs.forEach(t => t.addEventListener('click', () => showSeason(+t.dataset.season)));
      prev.addEventListener('click', () => { const t = step(-1); if (t) play(t.s, t.e); });
      next.addEventListener('click', () => { const t = step(1); if (t) play(t.s, t.e); });

      // Resume where this viewer left off
      try {
        const saved = JSON.parse(localStorage.getItem(EP_KEY) || 'null');
        if (saved && sIdx(saved.s) >= 0 && saved.e >= 1) Object.assign(state, { s: saved.s, e: saved.e });
      } catch {}
      if (sIdx(state.s) < 0 && seasons.length) state.s = seasons[0].n;
      showSeason(state.s);
    }

    load();
  }})();
