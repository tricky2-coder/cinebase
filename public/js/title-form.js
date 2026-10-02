// Add/edit title form: series-only fields, poster preview, TMDB auto-fill
const typeSel = document.getElementById('type');
const sync = () => document.querySelector('.form').classList.toggle('is-series', typeSel.value === 'Series');
typeSel.addEventListener('change', sync); sync();

const posterIn = document.getElementById('poster_url'), preview = document.getElementById('poster-preview');
posterIn.addEventListener('input', () => { preview.src = posterIn.value; preview.hidden = !posterIn.value; });

const q = document.getElementById('tmdb-q');
if (q) {
  const out = document.getElementById('tmdb-results'), form = document.getElementById('title-form');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function search() {
    if (!q.value.trim()) return;
    out.innerHTML = '<p class="muted">Searching…</p>';
    const r = await fetch('/titles/tmdb/search?q=' + encodeURIComponent(q.value));
    const data = await r.json();
    if (!r.ok) { out.innerHTML = `<p class="alert alert-error">${esc(data.error)}</p>`; return; }
    out.innerHTML = data.length ? data.map(d => `
      <button type="button" class="tmdb-hit" data-media="${esc(d.media)}" data-id="${esc(d.tmdb_id)}">
        ${d.poster ? `<img src="${esc(d.poster)}" alt="">` : '<span class="noimg"></span>'}
        <span><b>${esc(d.title)}</b><small>${esc(d.year || '—')} · ${d.media === 'tv' ? 'Series' : 'Movie'}</small></span>
      </button>`).join('') : '<p class="muted">No matches.</p>';
  }
  document.getElementById('tmdb-go').addEventListener('click', search);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  out.addEventListener('click', async e => {
    const hit = e.target.closest('.tmdb-hit'); if (!hit) return;
    hit.classList.add('loading');
    const r = await fetch(`/titles/tmdb/${hit.dataset.media}/${hit.dataset.id}`);
    const d = await r.json();
    if (!r.ok) { out.innerHTML = `<p class="alert alert-error">${esc(d.error)}</p>`; return; }
    for (const [k, v] of Object.entries(d)) {
      const el = form.elements[k];
      if (el && v !== '' && v != null) el.value = v;
    }
    sync(); posterIn.dispatchEvent(new Event('input'));
    out.innerHTML = `<p class="flash flash-success">Filled from TMDB: ${esc(d.title)}. Review and save.</p>`;
  });
}
