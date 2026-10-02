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

  // VidSrc player: mirror switcher (remembered per browser) + season/episode picker
  const player = document.getElementById('player');
  if (player) {
    const iframe = player.querySelector('iframe');
    const mirror = document.getElementById('p-mirror');
    const season = document.getElementById('p-season'), episode = document.getElementById('p-episode');
    const KEY = 'cinebase.mirror';
    const num = el => Math.max(1, parseInt(el.value, 10) || 1);
    const url = () => `https://${mirror.value}${player.dataset.path}` +
      (season ? `?season=${num(season)}&episode=${num(episode)}` : '');
    const load = () => { const u = url(); if (iframe.src !== u) iframe.src = u; };

    try {
      const saved = localStorage.getItem(KEY);
      if (saved && [...mirror.options].some(o => o.value === saved)) mirror.value = saved;
    } catch {}
    mirror.addEventListener('change', () => {
      try { localStorage.setItem(KEY, mirror.value); } catch {}
      load();
    });
    [season, episode].forEach(el => el && el.addEventListener('change', load));
    load();
  }
})();
