/**
 * Carian lirik & maklumat lagu sebenar daripada web tanpa API key:
 * - Spotify (carian trek + oEmbed rasmi untuk tajuk & artis tepat)
 * - Smule (sumber lirik lagu Melayu/Nusantara & antarabangsa paling tepat)
 * - Genius (API carian + lirik halaman penuh)
 * - DuckDuckGo Web Search ("lirik lagu ...")
 */

async function fetchTextWithTimeout(url, timeoutMs = 3200, headers = {}) {
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

function extractDdgResultUrls(html) {
  const urls = [];
  const matches = [...String(html || '').matchAll(/href="([^"]+)"/gi)];
  for (const m of matches) {
    let href = decodeHtmlEntities(m[1]);
    if (href.includes('uddg=')) {
      const u = href.match(/uddg=([^&]+)/);
      if (u) {
        try {
          href = decodeURIComponent(u[1]);
        } catch {
          // ignore
        }
      }
    }
    if (/^https?:\/\//i.test(href) && !href.includes('duckduckgo.com')) {
      urls.push(href);
    }
  }
  return [...new Set(urls)];
}

/**
 * Rujuk Spotify (carian web + Spotify oEmbed rasmi tanpa API key) untuk dapatkan
 * tajuk lagu & nama artis kanonik yang tepat.
 */
async function searchSpotifyTrack(query) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
    `site:open.spotify.com/track ${query}`
  )}`;
  const html = await fetchTextWithTimeout(ddgUrl, 3000);
  if (!html) return null;

  const urls = extractDdgResultUrls(html);
  const trackUrl = urls.find((u) => /open\.spotify\.com\/track\/[A-Za-z0-9]+/i.test(u));
  if (!trackUrl) return null;

  const cleanTrackUrl = trackUrl.split('?')[0];
  const oembedRaw = await fetchTextWithTimeout(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanTrackUrl)}`,
    2800,
    { Accept: 'application/json' }
  );

  let title = '';
  let artist = '';

  if (oembedRaw) {
    try {
      const oembed = JSON.parse(oembedRaw);
      title = (oembed.title || '').trim();
    } catch {
      // ignore
    }
  }

  // Cuba ambil artis daripada tajuk keputusan carian Spotify (cth. "Sua Sue Kemuning - song and lyrics by P. Ramlee | Spotify")
  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  for (const t of titleMatches.slice(0, 3)) {
    const byMatch = t.match(/^(.*?)\s*[-–—]\s*(?:song(?:\s+and\s+lyrics)?|lagu)\s+by\s+([^|]+)/i);
    if (byMatch) {
      if (!title) title = byMatch[1].trim();
      artist = byMatch[2].trim();
      break;
    }
  }

  if (!title) return null;
  return {
    title,
    artist: artist || '',
    spotifyUrl: cleanTrackUrl,
    source: 'Spotify',
  };
}

/**
 * Rujuk Smule (smule.com) — sangat tepat untuk lirik lagu Melayu, Indonesia & karaoke antarabangsa!
 */
async function searchSmuleLyrics(query) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
    `site:smule.com ${query} lyrics OR lirik`
  )}`;
  const html = await fetchTextWithTimeout(ddgUrl, 3000);
  if (!html) return null;

  const urls = extractDdgResultUrls(html);
  const smuleUrl = urls.find((u) => /smule\.com\/song\//i.test(u));

  // Ambil tajuk & artis daripada tajuk keputusan Smule dahulu
  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  let title = '';
  let artist = '';
  for (const t of titleMatches.slice(0, 3)) {
    const clean = t
      .replace(/\s*\|.*$/, '')
      .replace(/\b(lyrics?|lirik|smule|karaoke|sing)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = clean.split(/\s*[-–—]\s*/).filter(Boolean);
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts[1].trim();
      break;
    } else if (parts.length === 1 && parts[0].length >= 3) {
      title = parts[0].trim();
      break;
    }
  }

  let lyricsLines = [];

  // Cuba ambil lirik penuh terus daripada halaman Smule
  if (smuleUrl) {
    const pageHtml = await fetchTextWithTimeout(smuleUrl, 3200);
    if (pageHtml) {
      // Cuba ekstrak dari JSON-LD atau meta/kontena lirik Smule
      const ldMatches = [...pageHtml.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const m of ldMatches) {
        try {
          const obj = JSON.parse(m[1]);
          if (obj.name && !title) title = String(obj.name).trim();
          if (obj.byArtist?.name && !artist) artist = String(obj.byArtist.name).trim();
          if (obj.lyrics?.text) {
            lyricsLines = String(obj.lyrics.text)
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 2);
            break;
          }
        } catch {
          // ignore
        }
      }

      if (!lyricsLines.length) {
        const lyricBlock = pageHtml.match(/class="[^"]*lyrics[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (lyricBlock) {
          lyricsLines = decodeHtmlEntities(
            lyricBlock[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
          )
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 2 && l.length < 100);
        }
      }
    }
  }

  // Fallback snippet daripada hasil carian Smule jika halaman disekat
  if (!lyricsLines.length) {
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
      .filter(Boolean);

    for (const s of snippets.slice(0, 2)) {
      for (const part of s.replace(/\.\.\./g, '\n').split(/\r?\n|(?<=[.!?])\s+/)) {
        const line = part.trim();
        if (line.length >= 8 && line.length <= 95 && !/smule\.com/i.test(line)) {
          lyricsLines.push(line);
        }
      }
    }
  }

  if (!title && !lyricsLines.length) return null;
  return {
    title,
    artist,
    lyricsLines: lyricsLines.slice(0, 16),
    smuleUrl: smuleUrl || null,
    source: 'Smule',
  };
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

  if (hit.url) {
    const html = await fetchTextWithTimeout(hit.url, 3200);
    if (html) {
      const containers =
        html.match(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi) || [];
      const extracted = containers
        .map((c) => decodeHtmlEntities(c.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')))
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
    source: 'Genius',
  };
}

/**
 * Carian web umum "lirik lagu ..." sebagai sandaran tambahan.
 */
async function searchWebLyricsSnippet(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`lirik lagu ${query}`)}`;
  const html = await fetchTextWithTimeout(url, 3000);
  if (!html) return null;

  const titleMatches = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean);

  if (!titleMatches.length && !snippetMatches.length) return null;

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
  searchSpotifyTrack,
  searchSmuleLyrics,
  searchGeniusLyrics,
  searchWebLyricsSnippet,
};
