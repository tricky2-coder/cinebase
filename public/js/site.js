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
