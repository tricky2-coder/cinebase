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

  // Account menu (<details>): close on outside click / Escape
  const acct = document.querySelector('.s-acct');
  if (acct) {
    document.addEventListener('click', e => { if (acct.open && !acct.contains(e.target)) acct.open = false; });
    addEventListener('keydown', e => { if (e.key === 'Escape') acct.open = false; });
  }

  // Netflix-style hover preview: hovering a poster opens a larger card that plays the trailer muted.
  // Mouse/trackpad only, and off for people who prefer reduced motion.
  const mq = q => !!window.matchMedia?.(q).matches;
  if (mq('(hover: hover) and (pointer: fine)') && !mq('(prefers-reduced-motion: reduce)')) {
    const OPEN_DELAY = 600, CLOSE_DELAY = 180;
    const trailers = new Map(); // "movie:27205" -> YouTube key | null
    let openTimer, closeTimer, current = null, pv = null, req = 0;

    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    // Smaller TMDB backdrop for the card; fetched as soon as the hover starts
    const pvImg = card => (card.dataset.pvImg || '').replace('/t/p/w1280/', '/t/p/w780/');
    const ytCommand = (frame, func) => frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), 'https://www.youtube-nocookie.com');

    async function trailerFor(card) {
      if (card.dataset.pvYt) return card.dataset.pvYt;
      const { pvMedia: media, pvId: id } = card.dataset;
      if (!id) return null;
      const key = `${media}:${id}`;
      if (!trailers.has(key)) {
        try {
          const r = await fetch(`/preview/${media}/${id}`);
          trailers.set(key, r.ok ? (await r.json()).trailer : null);
        } catch { return null; }
      }
      return trailers.get(key);
    }

    // Close with the reverse morph back into the poster (or instantly, e.g. on scroll)
    function closePreview(instant = false) {
      clearTimeout(openTimer);
      current = null;
      if (!pv) return;
      const old = pv;
      pv = null;
      const done = () => { old.remove(); old._card?.classList.remove('pv-open'); };
      if (instant === true) return done();
      old.classList.remove('in');
      setTimeout(done, 320);
    }

    async function openPreview(card) {
      const myReq = ++req;
      if (pv) { pv.remove(); pv._card?.classList.remove('pv-open'); pv = null; }
      current = card;
      card.classList.add('pv-open'); // drop the poster's own hover lift so the morph starts from its real box
      const href = card.getAttribute('href');
      const poster = card.querySelector('.poster') || card;
      const pr = poster.getBoundingClientRect();
      const width = Math.min(Math.max(pr.width * 1.9, 300), 420);
      const left = Math.min(Math.max(pr.left + pr.width / 2 - width / 2, 8), innerWidth - width - 8);

      pv = mk('div', 'pv');
      pv._card = card;
      pv.style.width = `${width}px`;
      pv.style.left = `${left}px`;
      const inner = mk('div', 'pv-inner');
      const media = mk('div', 'pv-media');
      // Blurred poster fills the frame instantly; the backdrop fades in over it once loaded
      const posterSrc = poster.querySelector('img')?.currentSrc;
      if (posterSrc) { const blur = mk('img', 'pv-blur'); blur.src = posterSrc; blur.alt = ''; media.append(blur); }
      if (pvImg(card)) {
        const bg = mk('img', 'pv-bg');
        bg.alt = '';
        bg.addEventListener('load', () => bg.classList.add('on'));
        bg.src = pvImg(card);
        if (bg.complete) bg.classList.add('on');
        media.append(bg);
      }
      const body = mk('div', 'pv-body');
      const cta = mk('div', 'pv-cta');
      const playBtn = mk('a', 'sbtn sbtn-play', '▶ Play'); playBtn.href = `${href}#watch`;
      const info = mk('a', 'sbtn sbtn-glass', 'More info'); info.href = href;
      cta.append(playBtn, info);
      body.append(mk('b', null, card.dataset.pvTitle), mk('small', null, card.dataset.pvMeta), cta);
      // A copy of the poster sits exactly over the real one and fades out as the card opens
      const ghost = poster.cloneNode(true);
      ghost.className = 'poster pv-ghost';
      inner.append(media, body, ghost);
      pv.append(inner);
      pv.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      pv.addEventListener('mouseleave', () => { closeTimer = setTimeout(closePreview, CLOSE_DELAY); });
      document.body.append(pv);

      // Centre on the poster, kept inside the viewport
      const h = pv.offsetHeight;
      const top = Math.min(Math.max(pr.top + pr.height / 2 - h / 2, 8), innerHeight - h - 8);
      pv.style.top = `${top}px`;
      // Start clipped to the poster's box (relative to the card), then grow to the full card
      const x = pr.left - left, y = pr.top - top;
      Object.assign(ghost.style, { left: `${x}px`, top: `${y}px`, width: `${pr.width}px`, height: `${pr.height}px` });
      const clamp = v => Math.max(0, Math.round(v));
      inner.style.setProperty('--from', `inset(${clamp(y)}px ${clamp(width - x - pr.width)}px ${clamp(h - y - pr.height)}px ${clamp(x)}px round 8px)`);
      inner.getBoundingClientRect(); // commit the start state before transitioning
      requestAnimationFrame(() => pv?.classList.add('in'));

      const key = await trailerFor(card);
      if (myReq !== req || !pv || !key) return; // moved on, or no trailer: keep the still image
      const frame = mk('iframe');
      frame.title = `${card.dataset.pvTitle} trailer`;
      frame.allow = 'autoplay; encrypted-media';
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(key)}&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&enablejsapi=1`;
      frame.addEventListener('load', () => setTimeout(() => frame.classList.add('on'), 700)); // hide YouTube's loading frame
      let muted = true;
      const mute = mk('button', 'pv-mute', '🔇');
      mute.type = 'button';
      mute.setAttribute('aria-label', 'Unmute trailer');
      mute.addEventListener('click', e => {
        e.preventDefault();
        muted = !muted;
        ytCommand(frame, muted ? 'mute' : 'unMute');
        mute.textContent = muted ? '🔇' : '🔊';
        mute.setAttribute('aria-label', muted ? 'Unmute trailer' : 'Mute trailer');
      });
      media.append(frame, mute);
    }

    document.addEventListener('mouseover', e => {
      const card = e.target.closest('.card-p');
      if (!card || card === current) return;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      if (pvImg(card)) new Image().src = pvImg(card); // warm the cache during the hover delay
      openTimer = setTimeout(() => openPreview(card), OPEN_DELAY);
    });
    document.addEventListener('mouseout', e => {
      const card = e.target.closest('.card-p');
      if (!card || card.contains(e.relatedTarget)) return;
      clearTimeout(openTimer);
      if (card === current && !pv?.contains(e.relatedTarget)) closeTimer = setTimeout(closePreview, CLOSE_DELAY);
    });
    addEventListener('scroll', () => closePreview(true), { passive: true });
    document.querySelectorAll('.track').forEach(t => t.addEventListener('scroll', () => closePreview(true), { passive: true }));
    addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });
  }

  // VidSrc player: mirror switcher (remembered per browser) + season/episode picker for series
  const player = document.getElementById('player');
  if (player) {
    const cfg = JSON.parse(player.dataset.cfg);
    const iframe = player.querySelector('iframe');
    const mirror = document.getElementById('p-mirror');
    const MIRROR_KEY = 'cinebase.player', EP_KEY = `cinebase.ep.${cfg.key}`;
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

    // Pop-out: the player can move into an always-on-top Document Picture-in-Picture window
    // (Chrome/Edge) or, elsewhere, a plain pop-up window. While popped out the page frame is blank.
    let pipWin = null;   // the pop-out window
    let pipFrame = null; // player iframe inside a Document PiP window (null for a plain pop-up)
    const frame = () => pipFrame || iframe;

    const url = () => {
      const p = cfg.players[mirror.value];
      if (!p) return frame().src;
      const u = new URL(`https://${mirror.value}` + p.path
        .replace('{id}', encodeURIComponent(p.id)).replace('{s}', state.s).replace('{e}', state.e));
      if (p.events) {
        const t = resumeAt();
        if (t) u.searchParams.set('progress', t);
      }
      return u.href;
    };
    const load = () => {
      const u = url();
      if (pipWin && !pipFrame) { try { pipWin.location.href = u; } catch {} return; } // plain pop-up
      const f = frame();
      if (f.src !== u) f.src = u;
    };

    // Playback events posted by the player (JSON strings). Only trust our own iframe.
    let lastSaved = 0;
    function onPlayerMessage(e) {
      if (e.source !== frame().contentWindow || typeof e.data !== 'string') return;
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
    }
    addEventListener('message', onPlayerMessage);

    const popBtn = document.getElementById('p-popout');
    const popped = document.getElementById('p-popped');
    let pollClosed;

    function bringBack() {
      if (!pipWin) return;
      const w = pipWin;
      pipWin = null;
      pipFrame = null;
      clearInterval(pollClosed);
      player.classList.remove('popped');
      popped.hidden = true;
      popBtn.textContent = '⧉ Pop out';
      load(); // back in the page, resuming from the saved position
      try { if (!w.closed) w.close(); } catch {}
    }

    async function popOut() {
      if (pipWin) return bringBack();
      const u = url();
      if ('documentPictureInPicture' in window) {
        try {
          pipWin = await documentPictureInPicture.requestWindow({ width: 640, height: 360 });
        } catch { pipWin = null; }
      }
      if (pipWin) {
        const d = pipWin.document;
        d.title = document.querySelector('.d-info h1')?.childNodes[0]?.textContent.trim() || 'CineBase';
        const style = d.createElement('style');
        style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}';
        d.head.append(style);
        pipFrame = d.createElement('iframe');
        for (const a of ['allow', 'referrerpolicy', 'sandbox', 'allowfullscreen', 'title']) {
          if (iframe.hasAttribute(a)) pipFrame.setAttribute(a, iframe.getAttribute(a));
        }
        pipFrame.src = u;
        d.body.append(pipFrame);
        pipWin.addEventListener('message', onPlayerMessage); // the player now reports to the pop-out window
        pipWin.addEventListener('pagehide', bringBack);
      } else {
        // No Document PiP (Firefox, Safari): a normal small window — not always on top
        pipWin = window.open(u, 'cinebase-player', 'popup,width=720,height=405');
        if (!pipWin) { popBtn.textContent = 'Allow pop-ups to pop out'; return; }
        pollClosed = setInterval(() => { if (pipWin?.closed) bringBack(); }, 700);
      }
      iframe.src = 'about:blank'; // stop the page copy so audio doesn't play twice
      player.classList.add('popped');
      popped.hidden = false;
      popBtn.textContent = '⤓ Bring back';
    }

    popBtn.addEventListener('click', popOut);
    document.getElementById('p-bringback').addEventListener('click', bringBack);
    addEventListener('pagehide', () => { try { pipWin?.close(); } catch {} });

    try {
      const saved = localStorage.getItem(MIRROR_KEY);
      if (saved && [...mirror.options].some(o => o.value === saved)) mirror.value = saved;
    } catch {}
    mirror.addEventListener('change', () => {
      try { localStorage.setItem(MIRROR_KEY, mirror.value); } catch {}
      load();
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
      const first = s => seasons[sIdx(s)]?.start || 1; // anime tabs start at 101, 201, …
      const last = s => (count(s) ? first(s) + count(s) - 1 : null);
      const aired = (s, e) => { const ep = cache[s]?.find(x => x.n === e); return !ep || ep.aired; };
      const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

      async function episodes(s) {
        if (s in cache) return cache[s];
        if (!cfg.epBase) return (cache[s] = null);
        try {
          const r = await fetch(`${cfg.epBase}${s}`);
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
        const end = last(state.s);
        if (dir > 0) {
          if (!end || state.e < end) return aired(state.s, state.e + 1) ? { s: state.s, e: state.e + 1 } : null;
          const ns = seasons[sIdx(state.s) + 1];
          return ns ? { s: ns.n, e: first(ns.n) } : null;
        }
        if (state.e > first(state.s)) return { s: state.s, e: state.e - 1 };
        const ps = seasons[sIdx(state.s) - 1];
        return ps ? { s: ps.n, e: last(ps.n) || first(ps.n) } : null;
      }

      function mark() {
        list.querySelectorAll('.ep-card').forEach(c => {
          const on = shown === state.s && +c.dataset.e === state.e;
          c.classList.toggle('on', on);
          c.setAttribute('aria-current', on ? 'true' : 'false');
          if (on) list.scrollTo({ left: c.offsetLeft - list.offsetLeft - 8, behavior: 'smooth' }); // horizontal only
        });
        const name = cache[state.s]?.find(x => x.n === state.e)?.name;
        const label = cfg.anime ? `Episode ${state.e}` : `Season ${state.s} · Episode ${state.e}`;
        now.textContent = label + (name && name !== `Episode ${state.e}` ? ` — ${name}` : '');
        if (jump) jump.value = state.e;
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
        const items = eps?.length ? eps : Array.from({ length: count(s) || 0 }, (_, i) => ({ n: first(s) + i, name: `Episode ${first(s) + i}` }));
        list.replaceChildren(...(items.length ? items.map(ep => card(s, ep)) : [el('p', 'ep-msg', cfg.anime ? 'Episode list unavailable — enter an episode number or use Prev / Next.' : 'Episode list unavailable — use Prev / Next.')]));
        mark();
      }

      function play(s, e) {
        state.s = s; state.e = e;
        lastSaved = 0;
        try { localStorage.setItem(EP_KEY, JSON.stringify(state)); } catch {}
        load();
        if (shown !== s) showSeason(s); else mark();
      }
      onEnded = () => { const t = step(1); if (t) play(t.s, t.e); };

      tabs.forEach(t => t.addEventListener('click', () => showSeason(+t.dataset.season)));
      // Anime: jump straight to any episode number (long shows / unknown counts)
      const jump = document.getElementById('ep-jump');
      jump?.addEventListener('change', () => {
        const e = Math.max(1, parseInt(jump.value, 10) || 1);
        const tab = seasons.find(x => e >= first(x.n) && (!last(x.n) || e <= last(x.n))) || seasons[seasons.length - 1];
        play(tab.n, e);
      });
      prev.addEventListener('click', () => { const t = step(-1); if (t) play(t.s, t.e); });
      next.addEventListener('click', () => { const t = step(1); if (t) play(t.s, t.e); });

      // Resume where this viewer left off
      try {
        const saved = JSON.parse(localStorage.getItem(EP_KEY) || 'null');
        if (saved && sIdx(saved.s) >= 0 && saved.e >= 1) Object.assign(state, { s: saved.s, e: saved.e });
      } catch {}
      if (sIdx(state.s) < 0 && seasons.length) state.s = seasons[0].n;
      if (state.e < first(state.s)) state.e = first(state.s);
      showSeason(state.s);
    }

    load();
  }})();
