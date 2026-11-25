const { SONGS_DB } = require('../data/songsDb');
const config = require('../config');

/**
 * Normalisasi teks Melayu/Inggeris untuk carian kabur (fuzzy).
 */
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalisasi fonetik Melayu supaya typo seperti:
 * "sua sue kumoning" == "sua sue kemoning"
 * "burong kakak tua" == "burung kakak tua"
 * "can mali can" == "chan mali chan"
 */
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
 * Cari dalam pangkalan data lagu & melodi tempatan.
 */
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

  if (bestSong && bestScore >= 0.62) {
    return { song: bestSong, score: bestScore };
  }
  return null;
}

async function fetchJson(url, timeoutMs = 2500) {
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
    const lyricsText = (item.plainLyrics || '').slice(0, 600);
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

/**
 * Cari melodi mengikut nama/id yang diminta pengguna (cth. "rasa sayang", "sua sue").
 */
function findMelodyByName(name) {
  if (!name) return null;
  const hit = searchLocalSongs(name);
  return hit ? hit.song : null;
}

/**
 * Pilih melodi paling sesuai untuk teks bebas yang tiada lagu sebenar.
 */
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

  // Pilihan deterministik pelbagai irama rakyat supaya seronok & tidak bosan
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

/**
 * Sesuaikan teks/mesej rawak menjadi 4 baris lirik berirama ikut melodi pilihan.
 */
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
    // Teks sangat pendek: jadikan rangkap pantun/korus ceria menggunakan perkataan pengguna
    const core = words.join(' ');
    lines = [
      `${core}, oh ${core} hari ini`,
      `Mari kita nyanyi, ${core} bersama di sini`,
      `Dengar irama merdu, ${core} di dalam hati`,
      `Oh ${core}, riang ria sepanjang hari`,
    ];
  } else if (words.length <= 12) {
    // Teks sederhana: pecah 2 bahagian dan sambung dengan korus berima
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
    // Teks panjang: bahagikan seimbang kepada bilangan frasa melodi (maks 28 patah perkataan)
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

/**
 * Ekstrak 3-4 baris lirik terbaik daripada lirik penuh LRCLIB (berdekatan dengan kata kunci query).
 */
function extractBestLyricsExcerpt(fullLyrics, query) {
  const lines = String(fullLyrics || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !l.startsWith('['));

  if (!lines.length) return [];

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i++) {
    const score = computeSimilarity(query, lines[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const start = Math.max(0, bestIdx);
  return lines.slice(start, start + 4);
}

/**
 * Fungsi utama carian lagu & penyesuaian lirik (100% tanpa API key).
 * @param {string} rawQuery - Teks/lirik daripada pengguna
 * @param {object} options - { forceBotVoice?: boolean, preferredMelody?: string }
 */
async function findSongOrAdapt(rawQuery, options = {}) {
  const query = String(rawQuery || '').trim();
  const forceBotVoice = Boolean(options.forceBotVoice);

  // 1. Jika pengguna tetapkan melodi tertentu, terus sesuaikan lirik ikut melodi itu
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
      source: 'Suai Padan Irama Pilihan',
      matchedFrom: query,
    };
  }

  // 2. Semak pangkalan data lagu & irama tempatan (fuzzy + fonetik)
  const localHit = searchLocalSongs(query);

  if (localHit) {
    const song = localHit.song;
    let previewUrl = null;
    let previewSource = null;

    // Dalam mod Hibrid (bukan paksa suara bot), cuba dapatkan klip audio sebenar dari Deezer/iTunes
    if (!forceBotVoice) {
      const [dz, it] = await Promise.all([
        searchDeezer(song.title),
        searchItunes(song.title),
      ]);
      if (dz && dz.previewUrl && dz.score >= 0.65) {
        previewUrl = dz.previewUrl;
        previewSource = 'Deezer';
      } else if (it && it.previewUrl && it.score >= 0.65) {
        previewUrl = it.previewUrl;
        previewSource = 'iTunes';
      }
    }

    return {
      found: true,
      mode: previewUrl && !forceBotVoice ? 'real_audio_clip' : 'real_melody_bot_sing',
      title: song.title,
      artist: song.artist,
      melodySong: song,
      phrases: song.phrases,
      lyricsText: song.phrases.map((p) => p.text).join('\n'),
      previewUrl,
      source: previewSource
        ? `Pangkalan Data Lagu + Klip ${previewSource}`
        : 'Pangkalan Data Irama Sebenar',
      confidence: Math.round(localHit.score * 100),
      matchedFrom: query,
    };
  }

  // 3. Carian atas talian percuma secara selari (LRCLIB + Deezer + iTunes)
  const [lrc, dzRaw, itRaw] = await Promise.all([
    searchLrclib(query),
    searchDeezer(query),
    searchItunes(query),
  ]);

  // Jika LRCLIB jumpa tajuk lagu daripada potongan lirik, cari klip audio sebenar menggunakan tajuk itu
  if (lrc) {
    let previewUrl = null;
    let previewSource = null;

    if (!forceBotVoice) {
      const exactTerm = `${lrc.title} ${lrc.artist}`;
      const [dzExact, itExact] = await Promise.all([
        searchDeezer(exactTerm),
        searchItunes(exactTerm),
      ]);

      if (dzExact && dzExact.previewUrl && dzExact.score >= 0.5) {
        previewUrl = dzExact.previewUrl;
        previewSource = 'Deezer';
      } else if (itExact && itExact.previewUrl && itExact.score >= 0.5) {
        previewUrl = itExact.previewUrl;
        previewSource = 'iTunes';
      }
    }

    const excerpt = extractBestLyricsExcerpt(lrc.lyrics, query);
    const fallbackMelody = pickBestMelodyForText(excerpt.join(' ') || lrc.title);
    const singPhrases = excerpt.length
      ? fallbackMelody.phrases.map((p, i) => ({
          ...p,
          text: excerpt[i] || excerpt[i % excerpt.length],
        }))
      : adaptLyricsToMelody(query, fallbackMelody);

    return {
      found: true,
      mode: previewUrl && !forceBotVoice ? 'real_audio_clip' : 'real_melody_bot_sing',
      title: lrc.title,
      artist: lrc.artist,
      melodySong: fallbackMelody,
      phrases: singPhrases,
      lyricsText: excerpt.length ? excerpt.join('\n') : singPhrases.map((p) => p.text).join('\n'),
      previewUrl,
      source: previewSource ? `LRCLIB + Klip ${previewSource}` : 'LRCLIB (Nyanyian Bot)',
      confidence: Math.round(lrc.score * 100),
      matchedFrom: query,
    };
  }

  // Semak hasil langsung Deezer / iTunes (ambang tinggi >= 0.68 supaya teks rawak tidak tersalah padan)
  const bestStream = [dzRaw, itRaw]
    .filter((x) => x && x.score >= 0.68)
    .sort((a, b) => b.score - a.score)[0];

  if (bestStream) {
    const fallbackMelody = pickBestMelodyForText(`${bestStream.title} ${query}`);
    const adapted = adaptLyricsToMelody(query, fallbackMelody);

    return {
      found: true,
      mode: bestStream.previewUrl && !forceBotVoice ? 'real_audio_clip' : 'real_melody_bot_sing',
      title: bestStream.title,
      artist: bestStream.artist,
      melodySong: fallbackMelody,
      phrases: adapted,
      lyricsText: adapted.map((p) => p.text).join('\n'),
      previewUrl: bestStream.previewUrl,
      source: `Carian ${bestStream.source}`,
      confidence: Math.round(bestStream.score * 100),
      matchedFrom: query,
    };
  }

  // 4. Tidak jumpa lagu sebenar -> sesuaikan teks kepada lirik & nyanyikan ikut irama sebenar!
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
