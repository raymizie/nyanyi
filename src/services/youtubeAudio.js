const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const yts = require('yt-search');
const config = require('../config');

const execFileAsync = promisify(execFile);

let cachedYtDlp = undefined;

function getYtDlpPath() {
  if (cachedYtDlp !== undefined) return cachedYtDlp;
  for (const bin of ['yt-dlp', 'yt-dlp.exe']) {
    const res = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    if (res.status === 0) {
      cachedYtDlp = bin;
      return cachedYtDlp;
    }
  }
  cachedYtDlp = null;
  return null;
}

function raceTimeout(promise, ms, fallbackValue = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeSimple(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreYouTubeCandidate(video, expectedTitle, expectedArtist) {
  const vt = normalizeSimple(video.title);
  const ch = normalizeSimple(video.author?.name || '');
  const combined = `${vt} ${ch}`;
  let score = 0;

  // Padanan tajuk lagu
  const titleTokens = normalizeSimple(expectedTitle)
    .split(' ')
    .filter((w) => w.length >= 2);
  if (titleTokens.length) {
    let hits = 0;
    for (const t of titleTokens) {
      if (vt.includes(t)) hits++;
    }
    score += (hits / titleTokens.length) * 50;
  }

  // Padanan artis (sangat penting supaya dapat penyanyi sebenar, bukan cover/DJ rawak!)
  const artistTokens = normalizeSimple(expectedArtist)
    .split(' ')
    .filter((w) => w.length >= 3 && !['tan', 'sri', 'ost', 'nasib', 'tidak', 'diketahui'].includes(w));
  if (artistTokens.length) {
    let ahits = 0;
    for (const a of artistTokens) {
      if (combined.includes(a)) ahits++;
    }
    score += (ahits / artistTokens.length) * 30;
  }

  // Utamakan video lirik / official audio (biasanya terus masuk lagu tanpa dialog filem panjang!)
  if (/\b(lirik|lyric|lyrics|official audio|audio)\b/i.test(video.title)) score += 18;
  if (/\b(official)\b/i.test(video.title)) score += 6;

  // Tolak video yang bukan lagu asal (karaoke, remix, cover, tutorial, babak filem panjang)
  if (/\b(karaoke|minus one|minusone|instrumental|remix|dj|slowed|reverb|sped up|tutorial|guitar lesson|reaction)\b/i.test(video.title)) {
    score -= 35;
  }
  if (/\b(cover)\b/i.test(video.title)) score -= 18;

  // Tempoh lagu normal (1.5 minit hingga 6 minit) mendapat bonus
  if (video.seconds >= 80 && video.seconds <= 360) score += 10;
  else if (video.seconds > 420) score -= 25;

  return score;
}

/**
 * Cari video lagu sebenar di YouTube — utamakan video Lirik / Official Audio artis sebenar
 * supaya terus masuk bahagian nyanyian dan tidak tersilap lagu/cover.
 */
async function searchYouTubeSongAndKaraoke(query, knownTitle = '', knownArtist = '') {
  const cleanArtist =
    knownArtist && !/tidak diketahui|bot nyanyi|lagu rakyat/i.test(knownArtist)
      ? knownArtist.split(/[(&,]/)[0].trim()
      : '';
  const searchTerm = [knownTitle || query, cleanArtist].filter(Boolean).join(' ');

  const lyricSearchPromise = yts(`${searchTerm} lirik`)
    .then((r) => (r?.videos || []).filter((v) => v.seconds >= 30 && v.seconds <= 540))
    .catch(() => []);

  const audioSearchPromise = yts(`${searchTerm} official audio`)
    .then((r) => (r?.videos || []).filter((v) => v.seconds >= 30 && v.seconds <= 540))
    .catch(() => []);

  const [lyricVideos, audioVideos] = await raceTimeout(
    Promise.all([lyricSearchPromise, audioSearchPromise]),
    4200,
    [[], []]
  );

  // Gabung & susun mengikut skor ketepatan artis + tajuk + video lirik
  const seen = new Set();
  const merged = [];
  for (const v of [...lyricVideos.slice(0, 6), ...audioVideos.slice(0, 6)]) {
    if (!seen.has(v.videoId)) {
      seen.add(v.videoId);
      merged.push({
        video: v,
        score: scoreYouTubeCandidate(v, knownTitle || query, cleanArtist),
      });
    }
  }
  merged.sort((a, b) => b.score - a.score);

  const songVideo = merged[0]?.video || null;

  return {
    songVideo: songVideo
      ? {
          videoId: songVideo.videoId,
          title: songVideo.title,
          author: songVideo.author?.name || 'YouTube',
          url: songVideo.url,
          seconds: songVideo.seconds,
          description: songVideo.description || '',
          matchScore: Math.round(merged[0]?.score || 0),
        }
      : null,
    karaokeVideo: null,
  };
}

function formatSectionTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * Muat turun bahagian lagu daripada YouTube menggunakan yt-dlp.
 * - Jika `startSec` (dari lirik terselaras LRCLIB) diketahui, terus lompat ke bahagian lirik!
 * - Jika tidak diketahui, muat turun 0:00–1:05 supaya pengesan vokal (`detectVocalStartSec`)
 *   boleh melangkau intro panjang dan memulakan nyanyian tepat bila vokal bermula!
 */
async function downloadViaYtDlp(videoId, outPath, startSec = null) {
  const ytdlp = getYtDlpPath();
  if (!ytdlp) return false;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const section =
    startSec != null && startSec > 1
      ? `*${formatSectionTime(Math.max(0, startSec - 1))}-${formatSectionTime(startSec + 30)}`
      : '*0:00-1:05';

  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '--download-sections', section,
    '--force-keyframes-at-cuts',
    '--extractor-args', 'youtube:player_client=android_vr,ios,web',
    '-o', outPath,
    url,
  ];

  let cookiePath = null;
  if (process.env.YOUTUBE_COOKIES_B64) {
    try {
      cookiePath = path.join(config.TMP_DIR, `ytc-${crypto.randomBytes(4).toString('hex')}.txt`);
      fs.writeFileSync(cookiePath, Buffer.from(process.env.YOUTUBE_COOKIES_B64, 'base64'));
      args.unshift('--cookies', cookiePath);
    } catch {
      cookiePath = null;
    }
  }

  try {
    await execFileAsync(ytdlp, args, { timeout: 16000, maxBuffer: 5 * 1024 * 1024 });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 4096;
  } catch {
    return false;
  } finally {
    if (cookiePath) {
      try {
        fs.unlinkSync(cookiePath);
      } catch {
        // ignore
      }
    }
  }
}

const PUBLIC_YT_INSTANCES = [
  { type: 'piped', base: 'https://pipedapi.kavin.rocks' },
  { type: 'piped', base: 'https://pipedapi.adminforge.de' },
  { type: 'invidious', base: 'https://inv.nadeko.net' },
  { type: 'invidious', base: 'https://yewtu.be' },
];

async function fetchStreamUrlFromInstance(inst, videoId) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, 3200);
  });

  const task = (async () => {
    const apiUrl =
      inst.type === 'piped'
        ? `${inst.base}/streams/${videoId}`
        : `${inst.base}/api/v1/videos/${videoId}`;

    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BotNyanyiWhatsApp/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (inst.type === 'piped' && Array.isArray(data.audioStreams) && data.audioStreams.length) {
      const best = data.audioStreams.find((s) => s.url) || data.audioStreams[0];
      if (best?.url) return best.url;
    }
    if (inst.type === 'invidious' && Array.isArray(data.adaptiveFormats)) {
      const audio = data.adaptiveFormats.find(
        (f) => String(f.type || '').startsWith('audio/') && f.url
      );
      if (audio?.url) return audio.url;
    }
    throw new Error('no audio stream');
  })();

  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadPartialUrl(url, outPath, maxBytes = 1400 * 1024, timeoutMs = 6000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('download timeout'));
    }, timeoutMs);
  });

  const task = (async () => {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Range: `bytes=0-${maxBytes}`,
      },
    });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4096) throw new Error('buffer too small');
    fs.writeFileSync(outPath, buf);
    return true;
  })();

  try {
    return await Promise.race([task, timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadViaPublicInstances(videoId, outPath) {
  try {
    const streamUrl = await Promise.any(
      PUBLIC_YT_INSTANCES.map((inst) => fetchStreamUrlFromInstance(inst, videoId))
    );
    return await downloadPartialUrl(streamUrl, outPath);
  } catch {
    return false;
  }
}

/**
 * Muat turun audio lagu sebenar (YouTube yt-dlp -> YouTube Stream -> Deezer/iTunes preview).
 */
async function fetchRealAudioFile({ videoId, previewUrl, startSec = null }) {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const outPath = path.join(config.TMP_DIR, `yt-${crypto.randomBytes(5).toString('hex')}.m4a`);

  if (videoId) {
    const okYtDlp = await downloadViaYtDlp(videoId, outPath, startSec);
    if (okYtDlp) {
      return {
        path: outPath,
        source: 'YouTube',
        alreadyCutAtStartSec: Boolean(startSec != null && startSec > 1),
      };
    }

    const okPublic = await downloadViaPublicInstances(videoId, outPath);
    if (okPublic) {
      return { path: outPath, source: 'YouTube Stream', alreadyCutAtStartSec: false };
    }
  }

  if (previewUrl) {
    const okPrev = await downloadPartialUrl(previewUrl, outPath, 1600 * 1024, 5500);
    if (okPrev) {
      return { path: outPath, source: 'Audio Studio Rasmi', alreadyCutAtStartSec: false };
    }
  }

  return null;
}

module.exports = {
  searchYouTubeSongAndKaraoke,
  fetchRealAudioFile,
  getYtDlpPath,
};
