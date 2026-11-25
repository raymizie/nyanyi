const { SONGS_DB } = require('../data/songsDb');
const { searchYouTubeSongAndKaraoke } = require('./youtubeAudio');
const {
  searchSpotifyTrack,
  searchSmuleLyrics,
  searchGeniusLyrics,
  searchWebLyricsSnippet,
} = require('./webLyricsSearch');

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phoneticNormalize(text) {
  return normalizeText(text)
    .replace(/ch/g, 'c')
    .replace(/sh|sy/g, 's')
    .replace(/kh/g, 'k')
    .replace(/q/g, 'k')
    .replace(/oe|u/g, 'o')
    .replace(/ie|y/g, 'i')
    .replace(/e/g, 'i')
    .replace(/([a-z])\1+/g, '$1');
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function tokenOverlapScore(queryStr, targetStr) {
  const qTokens = phoneticNormalize(queryStr).split(' ').filter(Boolean);
  const tTokens = phoneticNormalize(targetStr).split(' ').filter(Boolean);
  if (!qTokens.length || !tTokens.length) return 0;

  let matched = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) {
      if (qt === tt) {
        best = 1;
        break;
      }
      const sim = diceSimilarity(qt, tt);
      if (sim > best) best = sim;
    }
    if (best >= 0.65) matched += best;
  }

  return matched / qTokens.length;
}

function computeSimilarity(query, candidate) {
  const qNorm = normalizeText(query);
  const cNorm = normalizeText(candidate);
  if (!qNorm || !cNorm) return 0;
  if (cNorm.includes(qNorm) && qNorm.length >= 4) return 0.96;

  const qPhon = phoneticNormalize(query);
  const cPhon = phoneticNormalize(candidate);
  if (cPhon.includes(qPhon) && qPhon.length >= 4) return 0.94;

  const diceRaw = diceSimilarity(qNorm, cNorm);
  const dicePhon = diceSimilarity(qPhon, cPhon);
  const tokOverlap = tokenOverlapScore(query, candidate);

  return Math.max(diceRaw, dicePhon, tokOverlap * 0.92);
}

/**
 * Bersihkan tajuk bergaya YouTube ("Ed Sheeran - Perfect (Lyrics) [Baby Im Dancing...]",
 * "Komang - Raim Laode Feat ...") supaya mendapat tajuk lagu & artis sebenar untuk carian audio rasmi.
 */
function cleanCanonicalTitleArtist(rawTitle, rawArtist) {
  let title = String(rawTitle || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\b(official|lyric|lyrics|lirik|video|audio|hd|mv|4k)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  let artist = String(rawArtist || '').trim();

  // Jika tajuk mengandungi pemisah " - " (cth. "Ed Sheeran - Perfect" atau "Komang - Raim Laode")
  const parts = title.split(/\s*[-–—|]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const p0 = parts[0].trim();
    const p1 = parts[1].replace(/\b(feat\.?|ft\.?)\b.*$/i, '').trim();
    const normArt = normalizeText(artist);

    if (normArt && normalizeText(p1).includes(normArt)) {
      // Format "Komang - Raim Laode" -> tajuk di kiri
      title = p0;
    } else if (normArt && normalizeText(p0).includes(normArt)) {
      // Format "Ed Sheeran - Perfect" -> tajuk di kanan
      title = p1;
    } else if (/\b(ch\.?|tv|music|lyrics?|lirik|official|channel|records)\b/i.test(artist) || !artist) {
      // Artis ialah nama saluran YouTube (cth. "Kinz Ch.") -> ambil artis dari kiri, tajuk dari kanan
      artist = p0;
      title = p1;
    } else {
      title = p0;
    }
  }

  return {
    title: title || rawTitle,
    artist: artist || rawArtist,
  };
}

/**
 * Semak sama ada nama artis daripada Deezer/iTunes benar-benar sepadan dengan artis asal
 * (elak memainkan versi DJ/remix/cover artis lain yang ada intro panjang!).
 */
function artistMatchesExpected(candidateArtist, expectedArtist) {
  if (!expectedArtist || /tidak diketahui|lagu rakyat|bot nyanyi/i.test(expectedArtist)) {
    return true;
  }
  const cleanExp = expectedArtist.split(/[(&,]/)[0].trim();
  const sim = computeSimilarity(cleanExp, candidateArtist || '');
  return sim >= 0.45;
}

/**
 * Hurai lirik terselaras LRC (`[mm:ss.xx] baris lirik`) untuk mendapatkan saat tepat
 * bahagian nyanyian yang diminta pengguna (atau baris nyanyian pertama untuk melangkau intro!).
 */
function parseSyncedLyricsTimestamp(syncedLyrics, query) {
  if (!syncedLyrics) return { startSec: null, lines: [] };

  const entries = [];
  for (const rawLine of String(syncedLyrics).split(/\r?\n/)) {
    const m = rawLine.match(/^\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]\s*(.*)$/);
    if (!m) continue;
    const sec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const text = m[3].trim();
    if (text.length >= 3 && !/^(music|instrumental|intro|♪|♫|\.+)$/i.test(text)) {
      entries.push({ sec, text });
    }
  }

  if (!entries.length) return { startSec: null, lines: [] };

  // Cari baris yang paling sepadan dengan lirik yang pengguna taip
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < entries.length; i++) {
    const s = computeSimilarity(query, entries[i].text);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }

  // Jika pengguna taip petikan lirik tertentu (padanan >= 0.55), terus lompat ke saat baris itu!
  // Jika pengguna taip tajuk lagu sahaja, terus lompat ke saat nyanyian baris pertama (elak intro)!
  const chosenIdx = bestScore >= 0.55 ? bestIdx : 0;
  const startSec = entries[chosenIdx].sec;
  const lines = entries.slice(chosenIdx, chosenIdx + 4).map((e) => e.text);

  return { startSec, lines };
}

async function fetchJson(url, timeoutMs = 2800) {
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const fetchPromise = fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'BotNyanyiWhatsApp/1.0 (https://github.com)',
      Accept: 'application/json',
    },
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function searchLrclib(query) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, 3000);
  if (!Array.isArray(data) || !data.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.slice(0, 12)) {
    const tName = item.trackName || '';
    const aName = item.artistName || '';
    const titleScore = computeSimilarity(query, `${tName} ${aName}`);
    const lyricsText = (item.plainLyrics || '').slice(0, 900);
    const lyricsScore = lyricsText ? computeSimilarity(query, lyricsText) : 0;
    const syncBonus = item.syncedLyrics ? 0.04 : 0;
    // Penalti pada entri LRCLIB tidak rasmi yang meniru tajuk video YouTube (cth. "(Lyrics)", "LYRIC OFFICIAL")
    const spamPenalty = /\b(lyric|lyrics|lirik|official video|music video|karaoke|sped up|slowed|cover)\b|\[.*\]/i.test(
      tName
    )
      ? 0.22
      : 0;
    const score = Math.max(titleScore, lyricsScore) + syncBonus - spamPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 0.52) return null;
  return {
    title: best.trackName,
    artist: best.artistName,
    plainLyrics: best.plainLyrics || '',
    syncedLyrics: best.syncedLyrics || '',
    score: Math.min(1, bestScore),
    source: 'LRCLIB',
  };
}

async function searchDeezer(query, expectedArtist = '') {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=6`;
  const data = await fetchJson(url, 2600);
  if (!data || !Array.isArray(data.data) || !data.data.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.data) {
    if (!artistMatchesExpected(item.artist?.name, expectedArtist)) continue;
    const combined = `${item.title || ''} ${item.artist?.name || ''}`;
    let score = Math.max(
      computeSimilarity(query, item.title || ''),
      computeSimilarity(query, combined)
    );
    if (/\b(remix|karaoke|instrumental|lullaby|8-bit)\b/i.test(item.title || '')) {
      score -= 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 0.52) return null;
  return {
    title: best.title,
    artist: best.artist?.name || 'Tidak diketahui',
    previewUrl: best.preview || null,
    score: bestScore,
    source: 'Deezer',
  };
}

async function searchItunes(query, expectedArtist = '') {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&media=music&entity=song&limit=6`;
  const data = await fetchJson(url, 2600);
  if (!data || !Array.isArray(data.results) || !data.results.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.results) {
    if (!artistMatchesExpected(item.artistName, expectedArtist)) continue;
    const combined = `${item.trackName || ''} ${item.artistName || ''}`;
    let score = Math.max(
      computeSimilarity(query, item.trackName || ''),
      computeSimilarity(query, combined)
    );
    if (/\b(remix|karaoke|instrumental|lullaby)\b/i.test(item.trackName || '')) {
      score -= 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 0.52) return null;
  return {
    title: best.trackName,
    artist: best.artistName || 'Tidak diketahui',
    previewUrl: best.previewUrl || null,
    score: bestScore,
    source: 'iTunes',
  };
}

function searchLocalFallback(query) {
  let bestSong = null;
  let bestScore = 0;

  for (const song of SONGS_DB) {
    const candidates = [
      song.title,
      ...(song.aliases || []),
      ...song.phrases.map((p) => p.text),
    ];
    for (const cand of candidates) {
      const score = computeSimilarity(query, cand);
      if (score > bestScore) {
        bestScore = score;
        bestSong = song;
      }
    }
  }

  if (bestSong && bestScore >= 0.72) {
    return { song: bestSong, score: bestScore };
  }
  return null;
}

function pickBestMelodyForText(text) {
  const norm = normalizeText(text);
  let bestSong = null;
  let bestHits = 0;

  for (const song of SONGS_DB) {
    let hits = 0;
    for (const kw of song.moodKeywords || []) {
      if (norm.includes(kw)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestSong = song;
    }
  }

  if (bestSong) return bestSong;

  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) >>> 0;
  }
  return SONGS_DB[hash % SONGS_DB.length];
}

function adaptLyricsToMelody(rawText, melodySong) {
  const cleaned = String(rawText || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter(Boolean);
  const phraseCount = melodySong.phrases.length;

  let lines = [];

  if (words.length <= 4) {
    const core = words.join(' ');
    lines = [
      `${core}, oh ${core} hari ini`,
      `Mari kita nyanyi, ${core} bersama di sini`,
      `Dengar irama merdu, ${core} di dalam hati`,
      `Oh ${core}, riang ria sepanjang hari`,
    ];
  } else if (words.length <= 12) {
    const mid = Math.ceil(words.length / 2);
    const part1 = words.slice(0, mid).join(' ');
    const part2 = words.slice(mid).join(' ');
    lines = [
      `${part1}, ${part2}`,
      `Dengar semua kawan, ${part1}`,
      `Jangan lupa pula, ${part2}`,
      `${part1}, ${part2}, la la la`,
    ];
  } else {
    const trimmed = words.slice(0, 28);
    const perLine = Math.ceil(trimmed.length / phraseCount);
    for (let i = 0; i < phraseCount; i++) {
      const chunk = trimmed.slice(i * perLine, (i + 1) * perLine).join(' ');
      if (chunk) lines.push(chunk);
    }
    while (lines.length < phraseCount) {
      lines.push(lines[lines.length % Math.max(1, lines.length)] || cleaned);
    }
  }

  return melodySong.phrases.map((phrase, idx) => ({
    ...phrase,
    text: lines[idx] || lines[idx % lines.length] || phrase.text,
  }));
}

function extractBestLyricsLines(linesArr, query, maxLines = 4) {
  const cleanLines = (linesArr || [])
    .map((l) => String(l || '').trim())
    .filter((l) => l.length > 2 && !/^\[.*\]$/.test(l));

  if (!cleanLines.length) return [];

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < cleanLines.length; i++) {
    const score = computeSimilarity(query, cleanLines[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return cleanLines.slice(bestIdx, bestIdx + maxLines);
}

function linesToPhrases(lines, fallbackMelody) {
  const chosen = lines.slice(0, 4);
  return fallbackMelody.phrases.map((p, idx) => ({
    ...p,
    text: chosen[idx] || chosen[idx % chosen.length] || p.text,
  }));
}

/**
 * Carian sejagat untuk SEBARANG lagu menggunakan rujukan:
 * Spotify + Smule + LRCLIB (lirik terselaras bertimestamp!) + Genius + YouTube + Deezer + iTunes.
 * Jika tiada lagu sepadan, teks disesuaikan menjadi lirik untuk dinyanyikan oleh AI Studio.
 */
async function findSongOrAdapt(rawQuery) {
  const query = String(rawQuery || '').trim();

  // 1. Carian selari merentas semua sumber utama (Spotify, Smule, LRCLIB, Genius, Web, YouTube)
  const [spotify, smule, lrc, genius, webLyr, ytRaw] = await Promise.all([
    searchSpotifyTrack(query),
    searchSmuleLyrics(query),
    searchLrclib(query),
    searchGeniusLyrics(query),
    searchWebLyricsSnippet(query),
    searchYouTubeSongAndKaraoke(query),
  ]);

  const localHit = searchLocalFallback(query);

  // 2. Gabungkan identiti lagu paling tepat (Utamakan Spotify / LRCLIB / Smule / Genius)
  let detectedTitle = '';
  let detectedArtist = '';
  let detectedLines = [];
  let vocalStartSec = null;
  const sourcesUsed = [];

  if (spotify && computeSimilarity(query, `${spotify.title} ${spotify.artist}`) >= 0.5) {
    detectedTitle = spotify.title;
    detectedArtist = spotify.artist;
    sourcesUsed.push('Spotify');
  }

  if (lrc) {
    if (!detectedTitle) detectedTitle = lrc.title;
    if (!detectedArtist) detectedArtist = lrc.artist;
    sourcesUsed.push('LRCLIB');

    const synced = parseSyncedLyricsTimestamp(lrc.syncedLyrics, query);
    if (synced.startSec != null) {
      vocalStartSec = synced.startSec;
      detectedLines = synced.lines;
    } else if (lrc.plainLyrics) {
      detectedLines = extractBestLyricsLines(lrc.plainLyrics.split(/\r?\n/), query, 4);
    }
  }

  if (smule && (smule.lyricsLines.length || smule.title)) {
    const smuleMatch = computeSimilarity(
      query,
      `${smule.title} ${smule.artist} ${smule.lyricsLines.slice(0, 6).join(' ')}`
    );
    if (smuleMatch >= 0.5) {
      if (!detectedTitle && smule.title) detectedTitle = smule.title;
      if (!detectedArtist && smule.artist) detectedArtist = smule.artist;
      if (!detectedLines.length && smule.lyricsLines.length) {
        detectedLines = extractBestLyricsLines(smule.lyricsLines, query, 4);
      }
      sourcesUsed.push('Smule');
    }
  }

  if (genius) {
    const gMatch = computeSimilarity(
      query,
      `${genius.title} ${genius.artist} ${genius.lyricsLines.slice(0, 6).join(' ')}`
    );
    if (gMatch >= 0.55) {
      if (!detectedTitle) detectedTitle = genius.title;
      if (!detectedArtist) detectedArtist = genius.artist;
      if (!detectedLines.length && genius.lyricsLines.length) {
        detectedLines = extractBestLyricsLines(genius.lyricsLines, query, 4);
      }
      sourcesUsed.push('Genius');
    }
  }

  if (!detectedTitle && localHit) {
    detectedTitle = localHit.song.title;
    detectedArtist = localHit.song.artist;
    if (!detectedLines.length) {
      detectedLines = localHit.song.phrases.map((p) => p.text);
    }
    sourcesUsed.push('Katalog Klasik');
  }

  if (!detectedTitle && webLyr?.title && computeSimilarity(query, `${webLyr.title} ${webLyr.lyricsLines.join(' ')}`) >= 0.58) {
    detectedTitle = webLyr.title;
    detectedArtist = webLyr.artist || '';
    if (!detectedLines.length) {
      detectedLines = extractBestLyricsLines(webLyr.lyricsLines, query, 4);
    }
    sourcesUsed.push('Carian Web');
  }

  if (!detectedTitle && ytRaw.songVideo && computeSimilarity(query, ytRaw.songVideo.title) >= 0.62) {
    // Bersihkan format tajuk YouTube "Artis - Tajuk (Lyrics) [...]" supaya dapat artis & tajuk sebenar
    const cleanYt = ytRaw.songVideo.title
      .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
      .replace(/\b(official|lyric|lyrics|lirik|video|audio|hd|mv|4k)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const dashParts = cleanYt.split(/\s*[-–—|]\s*/).filter(Boolean);
    if (dashParts.length >= 2) {
      detectedArtist = dashParts[0].trim();
      detectedTitle = dashParts[1].trim();
    } else {
      detectedTitle = cleanYt || ytRaw.songVideo.title;
      detectedArtist = '';
    }
    sourcesUsed.push('YouTube');
  }

  // 3. Jika lagu sebenar dikenal pasti -> bersihkan tajuk/artis rasmi, sahkan LRCLIB,
  //    kemudian cari video lirik YouTube & audio studio artis SEBENAR!
  if (detectedTitle) {
    const cleanedMeta = cleanCanonicalTitleArtist(detectedTitle, detectedArtist);
    detectedTitle = cleanedMeta.title;
    detectedArtist = cleanedMeta.artist;

    const cleanArtistInit =
      detectedArtist && !/tidak diketahui/i.test(detectedArtist)
        ? detectedArtist.split(/[(&,]/)[0].trim()
        : '';
    const initialTerm = [detectedTitle, cleanArtistInit].filter(Boolean).join(' ');

    if (!lrc) {
      const lrcExact = await searchLrclib(initialTerm);
      if (lrcExact) {
        const cleanedLrc = cleanCanonicalTitleArtist(lrcExact.title, lrcExact.artist);
        detectedTitle = cleanedLrc.title || detectedTitle;
        detectedArtist = cleanedLrc.artist || detectedArtist;
        if (!sourcesUsed.includes('LRCLIB')) sourcesUsed.push('LRCLIB');

        const synced2 = parseSyncedLyricsTimestamp(lrcExact.syncedLyrics, query);
        if (synced2.startSec != null) {
          vocalStartSec = synced2.startSec;
          if (!detectedLines.length) detectedLines = synced2.lines;
        } else if (!detectedLines.length && lrcExact.plainLyrics) {
          detectedLines = extractBestLyricsLines(lrcExact.plainLyrics.split(/\r?\n/), query, 4);
        }
      }
    }

    const cleanArtist =
      detectedArtist && !/tidak diketahui/i.test(detectedArtist)
        ? detectedArtist.split(/[(&,]/)[0].trim()
        : '';
    const exactTerm = [detectedTitle, cleanArtist].filter(Boolean).join(' ');

    const [ytExact, dzExact, itExact] = await Promise.all([
      searchYouTubeSongAndKaraoke(exactTerm, detectedTitle, cleanArtist),
      searchDeezer(exactTerm, cleanArtist),
      searchItunes(exactTerm, cleanArtist),
    ]);

    const bestYt = ytExact.songVideo || ytRaw.songVideo;
    if (bestYt && !sourcesUsed.includes('YouTube')) sourcesUsed.push('YouTube');

    // Ambil pratonton Deezer/iTunes HANYA jika artisnya tepat (elak DJ/remix artis lain!)
    const previewUrl =
      (dzExact?.previewUrl || null) ||
      (itExact?.previewUrl || null);

    if (!detectedArtist) {
      detectedArtist = dzExact?.artist || itExact?.artist || bestYt?.author || 'Tidak diketahui';
    }

    if (!detectedLines.length && localHit) {
      detectedLines = localHit.song.phrases.map((p) => p.text);
    }

    const fallbackMelody = localHit?.song || pickBestMelodyForText(`${detectedTitle} ${detectedLines.join(' ')}`);
    const phrases = detectedLines.length
      ? linesToPhrases(detectedLines, fallbackMelody)
      : adaptLyricsToMelody(query, fallbackMelody);

    return {
      found: true,
      mode: 'real_song',
      title: detectedTitle,
      artist: detectedArtist,
      melodySong: fallbackMelody,
      phrases,
      lyricsText: phrases.map((p) => p.text).join('\n'),
      vocalStartSec,
      previewUrl,
      spotifyUrl: spotify?.spotifyUrl || null,
      smuleUrl: smule?.smuleUrl || null,
      youtubeSongVideo: bestYt,
      source: sourcesUsed.join(' + ') || 'Carian Lagu',
      matchedFrom: query,
    };
  }

  // 4. Tidak jumpa lagu sebenar -> sesuaikan teks kepada lirik untuk dinyanyikan oleh AI Studio!
  const chosenMelody = pickBestMelodyForText(query);
  const adaptedPhrases = adaptLyricsToMelody(query, chosenMelody);

  return {
    found: false,
    mode: 'adapted_ai_sing',
    title: `Lirik Suai Padan`,
    artist: 'Bot Nyanyi AI Studio',
    melodySong: chosenMelody,
    phrases: adaptedPhrases,
    lyricsText: adaptedPhrases.map((p) => p.text).join('\n'),
    vocalStartSec: null,
    previewUrl: null,
    spotifyUrl: null,
    smuleUrl: null,
    youtubeSongVideo: null,
    source: 'Suai Padan Lirik + AI Studio',
    matchedFrom: query,
  };
}

module.exports = {
  findSongOrAdapt,
  adaptLyricsToMelody,
  SONGS_DB,
};
