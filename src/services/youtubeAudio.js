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

function titleMatches(videoTitle, expectedTitle) {
  const vt = normalizeSimple(videoTitle);
  const tokens = normalizeSimple(expectedTitle)
    .split(' ')
    .filter((w) => w.length >= 3);
  if (!tokens.length) return true;
  let hits = 0;
  for (const t of tokens) {
    if (vt.includes(t)) hits++;
  }
  return hits / tokens.length >= 0.5;
}

/**
 * Cari video lagu sebenar DAN versi karaoke/instrumental di YouTube (0 API key).
 */
async function searchYouTubeSongAndKaraoke(query, knownTitle = '') {
  const searchTerm = knownTitle || query;

  const songSearchPromise = yts(`${searchTerm} lagu official audio`)
    .then((r) => (r?.videos || []).filter((v) => v.seconds >= 25 && v.seconds <= 600))
    .catch(() => []);

  const karaokeSearchPromise = yts(`${searchTerm} karaoke instrumental minus one`)
    .then((r) => (r?.videos || []).filter((v) => v.seconds >= 25 && v.seconds <= 600))
    .catch(() => []);

  const [songVideos, karaokeVideos] = await raceTimeout(
    Promise.all([songSearchPromise, karaokeSearchPromise]),
    4000,
    [[], []]
  );

  // Pilih video lagu terbaik
  const songVideo = songVideos[0] || null;

  // Pilih karaoke hanya jika tajuknya benar-benar berkaitan karaoke/instrumental + tajuk lagu
  const karaokeVideo =
    karaokeVideos.find(
      (v) =>
        /(karaoke|instrumental|minus one|minusone|off vocal|backing track)/i.test(v.title) &&
        titleMatches(v.title, knownTitle || songVideo?.title || query)
    ) || null;

  return {
    songVideo: songVideo
      ? {
          videoId: songVideo.videoId,
          title: songVideo.title,
          author: songVideo.author?.name || 'YouTube',
          url: songVideo.url,
          seconds: songVideo.seconds,
          description: songVideo.description || '',
        }
      : null,
    karaokeVideo: karaokeVideo
      ? {
          videoId: karaokeVideo.videoId,
          title: karaokeVideo.title,
          author: karaokeVideo.author?.name || 'YouTube',
          url: karaokeVideo.url,
          seconds: karaokeVideo.seconds,
        }
      : null,
  };
}

/**
 * Muat turun klip 26 saat daripada YouTube menggunakan yt-dlp (pantas dengan --download-sections).
 */
async function downloadViaYtDlp(videoId, outPath) {
  const ytdlp = getYtDlpPath();
  if (!ytdlp) return false;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '--download-sections', '*0:02-0:28',
    '--force-keyframes-at-cuts',
    '--extractor-args', 'youtube:player_client=android_vr,ios,web',
    '-o', outPath,
    url,
  ];

  // Sokong cookies pilihan jika pengguna menetapkan YOUTUBE_COOKIES_B64 di Render
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
    await execFileAsync(ytdlp, args, { timeout: 14000, maxBuffer: 5 * 1024 * 1024 });
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

/**
 * Fallback YouTube audio stream melalui API awam Piped / Invidious (tanpa yt-dlp).
 */
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

async function downloadPartialUrl(url, outPath, maxBytes = 750 * 1024, timeoutMs = 5500) {
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
 * Muat turun klip audio sebenar (YouTube yt-dlp -> YouTube Piped/Invidious -> Deezer/iTunes preview).
 */
async function fetchRealAudioFile({ videoId, previewUrl }) {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const outPath = path.join(config.TMP_DIR, `yt-${crypto.randomBytes(5).toString('hex')}.m4a`);

  if (videoId) {
    const okYtDlp = await downloadViaYtDlp(videoId, outPath);
    if (okYtDlp) return { path: outPath, source: 'YouTube (yt-dlp)' };

    const okPublic = await downloadViaPublicInstances(videoId, outPath);
    if (okPublic) return { path: outPath, source: 'YouTube Stream' };
  }

  if (previewUrl) {
    const okPrev = await downloadPartialUrl(previewUrl, outPath, 1500 * 1024, 5000);
    if (okPrev) return { path: outPath, source: 'Pratonton Audio Sebenar' };
  }

  return null;
}

module.exports = {
  searchYouTubeSongAndKaraoke,
  fetchRealAudioFile,
  getYtDlpPath,
};
