// VidSrc embed player. Mirrors change often, so the list is configurable:
//   VIDSRC_DOMAINS=vidsrc.pm,vidsrc.cc,vidsrc.xyz,vidsrc.in   (first one is the default)
// VIDSRC_SANDBOX=1 sandboxes the iframe (blocks popups/redirects) — off by default
// because some mirrors refuse to play inside a sandbox.
const DEFAULT_DOMAINS = ['vidsrc.pm', 'vidsrc.cc', 'vidsrc.xyz', 'vidsrc.in'];

function domains() {
  const list = (process.env.VIDSRC_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  return list.length ? list : DEFAULT_DOMAINS;
}

const sandboxed = () => process.env.VIDSRC_SANDBOX === '1';

// Everything the detail page needs to build and switch the player, or null if the title has no id
function player(item) {
  const id = item.imdb_id || item.tmdb_id;
  if (!id) return null;
  const isSeries = item.type === 'Series';
  const path = `/embed/${isSeries ? 'tv' : 'movie'}/${id}`;
  const list = domains();
  return {
    domains: list,
    path,
    isSeries,
    seasons: isSeries ? item.seasons || null : null,
    src: `https://${list[0]}${path}${isSeries ? '?season=1&episode=1' : ''}`,
    sandbox: sandboxed()
  };
}

module.exports = { domains, player };
