/**
 * Carian lirik lagu sebenar daripada web (Genius, DuckDuckGo, LRCLIB) tanpa API key.
 */

async function fetchTextWithTimeout(url, timeoutMs = 3000, headers = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const task = fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'ms-MY,ms;q=0.9,id;q=0.8,en;q=0.7',
      ...headers,
    },
  })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null);

  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Cari tajuk, artis & lirik penuh melalui Genius Public Search API (0 API key).
 */
async function searchGeniusLyrics(query) {
  const apiUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`;
  const raw = await fetchTextWithTimeout(apiUrl, 2800, { Accept: 'application/json' });
  if (!raw) return null;

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const sections = json?.response?.sections || [];
  let hit = null;

  for (const sec of sections) {
    if (sec.type === 'song' || sec.type === 'lyric' || sec.type === 'top_hit') {
      const songHit = (sec.hits || []).find((h) => h.type === 'song' && h.result?.url);
      if (songHit) {
        hit = songHit.result;
        break;
      }
    }
  }

  if (!hit) return null;

  const title = hit.title || '';
  const artist = hit.primary_artist?.name || 'Tidak diketahui';
  let lyricsLines = [];

  // Cuba ambil baris lirik sebenar daripada halaman Genius
  if (hit.url) {
    const html = await fetchTextWithTimeout(hit.url, 3200);
    if (html) {
      const containers = html.match(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi) || [];
      const extracted = containers
        .map((c) =>
          decodeHtmlEntities(
            c
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<[^>]+>/g, '')
          )
        )
        .join('\n');

      lyricsLines = extracted
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 2 && !/^\[.*\]$/.test(l));
    }
  }

  return {
    title,
    artist,
    lyricsLines,
    source: 'Genius Web',
  };
}

/**
 * Cari petunjuk lagu & potongan lirik melalui carian web DuckDuckGo (seperti Google search "lirik lagu ...").
 */
async function searchWebLyricsSnippet(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`lirik lagu ${query}`)}`;
  const html = await fetchTextWithTimeout(url, 3000);
  if (!html) return null;

  // Ekstrak tajuk & snippet daripada keputusan carian web
  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  if (!titleMatches.length && !snippetMatches.length) return null;

  // Bersihkan tajuk keputusan carian lirik (cth: "Lirik Lagu Sua Sue Kemuning - P. Ramlee | Smule")
  let guessedTitle = '';
  let guessedArtist = '';
  for (const t of titleMatches.slice(0, 4)) {
    const clean = t
      .replace(/\b(lirik\s+lagu|lyrics?|chord|kord|smule|musixmatch|genius|youtube|official)\b/gi, '')
      .replace(/\|.*$/, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length >= 3) {
      const parts = clean.split(/\s*[-–—:]\s*/).filter(Boolean);
      guessedTitle = parts[0] || clean;
      guessedArtist = parts[1] || '';
      break;
    }
  }

  // Pecahkan snippet lirik menjadi baris-baris yang boleh dinyanyikan
  const snippetLines = [];
  for (const s of snippetMatches.slice(0, 3)) {
    const cleaned = s
      .replace(/\.\.\./g, '\n')
      .replace(/Lirik lagu[^.:]*[.:]/gi, '')
      .replace(/[•|]/g, '\n');

    for (const part of cleaned.split(/\r?\n|(?<=[.!?])\s+/)) {
      const line = part.trim();
      if (line.length >= 8 && line.length <= 90 && !/https?:\/\//i.test(line)) {
        snippetLines.push(line);
      }
    }
  }

  return {
    title: guessedTitle,
    artist: guessedArtist,
    lyricsLines: snippetLines.slice(0, 8),
    source: 'Carian Web Lirik',
  };
}

module.exports = {
  searchGeniusLyrics,
  searchWebLyricsSnippet,
};
