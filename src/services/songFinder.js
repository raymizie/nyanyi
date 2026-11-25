const { SONGS_DB } = require('../data/songsDb');
const { searchYouTubeSongAndKaraoke } = require('./youtubeAudio');
const { searchGeniusLyrics, searchWebLyricsSnippet } = require('./webLyricsSearch');

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

function searchLocalSongs(query) {
  let bestSong = null;
  let bestScore = 0;

  for (const song of SONGS_DB) {
    const candidates = [
      song.title,
      `${song.title} ${song.artist}`,
      ...(song.aliases || []),
      ...song.phrases.map((p) => p.text),
      song.phrases.map((p) => p.text).join(' '),
    ];

    for (const cand of candidates) {
      const score = computeSimilarity(query, cand);
      if (score > bestScore) {
        bestScore = score;
        bestSong = song;
      }
    }
  }

  if (bestSong && bestScore >= 0.64) {
    return { song: bestSong, score: bestScore };
  }
  return null;
}

async function fetchJson(url, timeoutMs = 2600) {
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
  const data = await fetchJson(url, 2800);
  if (!Array.isArray(data) || !data.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.slice(0, 8)) {
    const titleScore = computeSimilarity(query, `${item.trackName || ''} ${item.artistName || ''}`);
    const lyricsText = (item.plainLyrics || '').slice(0, 700);
    const lyricsScore = lyricsText ? computeSimilarity(query, lyricsText) : 0;
    const score = Math.max(titleScore, lyricsScore);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best || bestScore < 0.52) return null;
  return {
    title: best.trackName,
    artist: best.artistName,
    lyrics: best.plainLyrics || '',
    score: bestScore,
    source: 'LRCLIB',
  };
}

async function searchDeezer(query) {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`;
  const data = await fetchJson(url, 2500);
  if (!data || !Array.isArray(data.data) || !data.data.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.data) {
    const combined = `${item.title || ''} ${item.artist?.name || ''}`;
    const score = Math.max(
      computeSimilarity(query, item.title || ''),
      computeSimilarity(query, combined)
    );
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best) return null;
  return {
    title: best.title,
    artist: best.artist?.name || 'Tidak diketahui',
    previewUrl: best.preview || null,
    score: bestScore,
    source: 'Deezer',
  };
}

async function searchItunes(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&media=music&entity=song&limit=5`;
  const data = await fetchJson(url, 2500);
  if (!data || !Array.isArray(data.results) || !data.results.length) return null;

  let best = null;
  let bestScore = 0;

  for (const item of data.results) {
    const combined = `${item.trackName || ''} ${item.artistName || ''}`;
    const score = Math.max(
      computeSimilarity(query, item.trackName || ''),
      computeSimilarity(query, combined)
    );
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best) return null;
  return {
    title: best.trackName,
    artist: best.artistName || 'Tidak diketahui',
    previewUrl: best.previewUrl || null,
    score: bestScore,
    source: 'iTunes',
  };
}

function findMelodyByName(name) {
  if (!name) return null;
  const hit = searchLocalSongs(name);
  return hit ? hit.song : null;
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

  const defaultPool = SONGS_DB.filter((s) =>
    ['rasa-sayang', 'sua-sue-kemoning', 'chan-mali-chan', 'burung-kakak-tua', 'lenggang-kangkung'].includes(
      s.id
    )
  );
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) >>> 0;
  }
  return defaultPool[hash % defaultPool.length] || SONGS_DB[0];
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
 * Carian lagu & lirik sebenar (Web + Genius + LRCLIB + YouTube + Deezer + iTunes + DB Tempatan).
 * Jika tidak jumpa, sesuaikan teks menjadi lirik dan nyanyi ikut irama sebenar.
 */
async function findSongOrAdapt(rawQuery, options = {}) {
  const query = String(rawQuery || '').trim();
  const forceOriginalClip = Boolean(options.originalClip);

  // 1. Jika pengguna memilih irama tertentu secara manual (/nyanyi irama:...)
  if (options.preferredMelody) {
    const chosen = findMelodyByName(options.preferredMelody) || pickBestMelodyForText(query);
    const adaptedPhrases = adaptLyricsToMelody(query, chosen);
    return {
      found: false,
      mode: 'adapted_bot_sing',
      title: `Lirik Suai Padan (Irama ${chosen.title})`,
      artist: 'Bot Nyanyi WhatsApp',
      melodySong: chosen,
      phrases: adaptedPhrases,
      lyricsText: adaptedPhrases.map((p) => p.text).join('\n'),
      previewUrl: null,
      youtubeSongVideo: null,
      youtubeKaraokeVideo: null,
      source: `Suai Padan → Irama ${chosen.title}`,
      matchedFrom: query,
    };
  }

  // 2. Semak pangkalan data lagu tempatan (termasuk lirik sebenar Sua Sue Kemuning P. Ramlee!)
  const localHit = searchLocalSongs(query);
  if (localHit) {
    const song = localHit.song;
    // Cari lagu & karaoke SEBENAR di YouTube + pratonton Deezer/iTunes secara selari!
    const [yt, dz, it] = await Promise.all([
      searchYouTubeSongAndKaraoke(`${song.title} ${song.artist.split('(')[0]}`, song.title),
      searchDeezer(song.title),
      searchItunes(song.title),
    ]);

    const previewUrl =
      (dz && dz.previewUrl && dz.score >= 0.55 ? dz.previewUrl : null) ||
      (it && it.previewUrl && it.score >= 0.55 ? it.previewUrl : null);

    return {
      found: true,
      mode: forceOriginalClip ? 'real_audio_clip' : 'youtube_imitate_sing',
      title: song.title,
      artist: song.artist,
      melodySong: song,
      phrases: song.phrases,
      lyricsText: song.phrases.map((p) => p.text).join('\n'),
      previewUrl,
      youtubeSongVideo: yt.songVideo,
      youtubeKaraokeVideo: yt.karaokeVideo,
      source: yt.songVideo
        ? 'Lirik Sebenar + Irama YouTube'
        : previewUrl
          ? 'Lirik Sebenar + Audio Sebenar'
          : 'Pangkalan Data Lirik & Irama Sebenar',
      confidence: Math.round(localHit.score * 100),
      matchedFrom: query,
    };
  }

  // 3. Carian Lirik & Lagu Atas Talian SECARA SELARI (LRCLIB + Genius + Web Search + YouTube + Deezer + iTunes)
  const [lrc, genius, webLyr, ytRaw, dzRaw, itRaw] = await Promise.all([
    searchLrclib(query),
    searchGeniusLyrics(query),
    searchWebLyricsSnippet(query),
    searchYouTubeSongAndKaraoke(query),
    searchDeezer(query),
    searchItunes(query),
  ]);

  // Tentukan identiti lagu paling tepat daripada semua sumber web
  let detectedTitle = '';
  let detectedArtist = '';
  let detectedLines = [];
  let sourceName = '';
  let confidence = 0;

  if (lrc) {
    detectedTitle = lrc.title;
    detectedArtist = lrc.artist;
    detectedLines = extractBestLyricsLines(lrc.lyrics.split(/\r?\n/), query, 4);
    sourceName = 'LRCLIB + YouTube';
    confidence = Math.round(lrc.score * 100);
  } else if (genius && computeSimilarity(query, `${genius.title} ${genius.artist} ${genius.lyricsLines.slice(0, 6).join(' ')}`) >= 0.55) {
    detectedTitle = genius.title;
    detectedArtist = genius.artist;
    detectedLines = extractBestLyricsLines(genius.lyricsLines, query, 4);
    sourceName = 'Genius Web + YouTube';
    confidence = 85;
  } else if (webLyr && webLyr.title && computeSimilarity(query, `${webLyr.title} ${webLyr.lyricsLines.join(' ')}`) >= 0.58) {
    detectedTitle = webLyr.title;
    detectedArtist = webLyr.artist || ytRaw.songVideo?.author || 'Tidak diketahui';
    detectedLines = extractBestLyricsLines(webLyr.lyricsLines, query, 4);
    sourceName = 'Carian Web Lirik + YouTube';
    confidence = 80;
  } else if (ytRaw.songVideo && computeSimilarity(query, ytRaw.songVideo.title) >= 0.62) {
    detectedTitle = ytRaw.songVideo.title;
    detectedArtist = ytRaw.songVideo.author;
    sourceName = 'YouTube';
    confidence = Math.round(computeSimilarity(query, ytRaw.songVideo.title) * 100);
  } else {
    const bestStream = [dzRaw, itRaw]
      .filter((x) => x && x.score >= 0.66)
      .sort((a, b) => b.score - a.score)[0];
    if (bestStream) {
      detectedTitle = bestStream.title;
      detectedArtist = bestStream.artist;
      sourceName = bestStream.source;
      confidence = Math.round(bestStream.score * 100);
    }
  }

  // Jika lagu sebenar BERJAYA dikenal pasti daripada web/YouTube:
  if (detectedTitle) {
    // Pastikan kita ada video YouTube & audio preview yang tepat untuk tajuk lagu sebenar ini
    let ytFinal = ytRaw;
    let previewUrl =
      (dzRaw && dzRaw.previewUrl && dzRaw.score >= 0.55 ? dzRaw.previewUrl : null) ||
      (itRaw && itRaw.previewUrl && itRaw.score >= 0.55 ? itRaw.previewUrl : null);

    const exactTerm = `${detectedTitle} ${detectedArtist !== 'Tidak diketahui' ? detectedArtist : ''}`.trim();

    if (!ytFinal.songVideo || !ytFinal.karaokeVideo || !previewUrl) {
      const [ytExact, dzExact, itExact] = await Promise.all([
        !ytFinal.songVideo || !ytFinal.karaokeVideo
          ? searchYouTubeSongAndKaraoke(exactTerm, detectedTitle)
          : Promise.resolve(ytFinal),
        !previewUrl ? searchDeezer(exactTerm) : Promise.resolve(null),
        !previewUrl ? searchItunes(exactTerm) : Promise.resolve(null),
      ]);

      if (ytExact?.songVideo) ytFinal.songVideo = ytExact.songVideo;
      if (ytExact?.karaokeVideo) ytFinal.karaokeVideo = ytExact.karaokeVideo;
      if (!previewUrl) {
        previewUrl =
          (dzExact && dzExact.previewUrl ? dzExact.previewUrl : null) ||
          (itExact && itExact.previewUrl ? itExact.previewUrl : null);
      }
    }

    // Jika lirik belum lengkap, cuba ambil daripada Genius/web berdasarkan tajuk tepat yang ditemui
    if (!detectedLines.length && genius?.lyricsLines?.length) {
      detectedLines = extractBestLyricsLines(genius.lyricsLines, query, 4);
    }
    if (!detectedLines.length && webLyr?.lyricsLines?.length) {
      detectedLines = extractBestLyricsLines(webLyr.lyricsLines, query, 4);
    }

    const fallbackMelody = pickBestMelodyForText(`${detectedTitle} ${detectedLines.join(' ')}`);
    const phrases = detectedLines.length
      ? linesToPhrases(detectedLines, fallbackMelody)
      : adaptLyricsToMelody(query, fallbackMelody);

    return {
      found: true,
      mode: forceOriginalClip ? 'real_audio_clip' : 'youtube_imitate_sing',
      title: detectedTitle,
      artist: detectedArtist || 'Tidak diketahui',
      melodySong: fallbackMelody,
      phrases,
      lyricsText: phrases.map((p) => p.text).join('\n'),
      previewUrl,
      youtubeSongVideo: ytFinal.songVideo,
      youtubeKaraokeVideo: ytFinal.karaokeVideo,
      source: sourceName,
      confidence,
      matchedFrom: query,
    };
  }

  // 4. Tidak jumpa lagu sebenar -> sesuaikan teks kepada lirik & nyanyi ikut irama sebenar!
  const chosenMelody = pickBestMelodyForText(query);
  const adaptedPhrases = adaptLyricsToMelody(query, chosenMelody);

  return {
    found: false,
    mode: 'adapted_bot_sing',
    title: `Lirik Suai Padan (Irama ${chosenMelody.title})`,
    artist: 'Bot Nyanyi WhatsApp',
    melodySong: chosenMelody,
    phrases: adaptedPhrases,
    lyricsText: adaptedPhrases.map((p) => p.text).join('\n'),
    previewUrl: null,
    youtubeSongVideo: null,
    youtubeKaraokeVideo: null,
    source: `Suai Padan → Irama ${chosenMelody.title}`,
    matchedFrom: query,
  };
}

module.exports = {
  findSongOrAdapt,
  findMelodyByName,
  searchLocalSongs,
  adaptLyricsToMelody,
  SONGS_DB,
};
