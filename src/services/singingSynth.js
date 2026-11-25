const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const { synthesizeBackingTrack } = require('./melodySynth');

const execFileAsync = promisify(execFile);

let cachedFfmpegPath = null;

/**
 * Dapatkan laluan binary ffmpeg (utamakan sistem Linux/Docker, fallback kepada ffmpeg-static).
 */
function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  const sysCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (sysCheck.status === 0) {
    cachedFfmpegPath = 'ffmpeg';
    return cachedFfmpegPath;
  }

  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
      cachedFfmpegPath = staticPath;
      return cachedFfmpegPath;
    }
  } catch {
    // ignore
  }

  throw new Error('FFmpeg tidak ditemui. Sila pasang ffmpeg atau ffmpeg-static.');
}

async function runFfmpeg(args, timeoutMs = 15000) {
  const ffmpeg = getFfmpegPath();
  await execFileAsync(ffmpeg, ['-y', '-loglevel', 'error', ...args], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function ensureTmpDir() {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/**
 * Senarai model TTS percuma (auto-tukar ke model seterusnya jika ada ralat / had kadar / perlahan).
 */
const TTS_MODELS = [
  {
    name: 'Model Vokal A (Google TTS tw-ob)',
    buildUrl: (text, lang) =>
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  },
  {
    name: 'Model Vokal B (Google APIs gtx)',
    buildUrl: (text, lang) =>
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile',
    },
  },
  {
    name: 'Model Vokal C (Google Dict Fallback)',
    buildUrl: (text, lang) =>
      `https://translate.google.com/translate_tts?ie=UTF-8&client=dict-chrome-ex&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  },
  {
    name: 'Model Vokal D (StreamElements TTS)',
    buildUrl: (text) =>
      `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'BotNyanyiWhatsApp/1.0',
    },
  },
];

// Ingat model TTS mana yang paling lancar supaya permintaan seterusnya terus pantas
let preferredTtsModelIndex = 0;

/**
 * Muat turun satu model TTS dengan had masa keras (Promise.race) supaya tidak pernah tersangkut
 * walaupun DNS atau rangkaian perlahan.
 */
async function trySingleTtsModel(model, idx, cleanText, lang, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('TTS timeout'));
    }, timeoutMs);
  });

  const fetchTask = (async () => {
    const res = await fetch(model.buildUrl(cleanText, lang), {
      signal: controller.signal,
      headers: model.headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) throw new Error('HTML response');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 400) throw new Error('Audio too small');
    return { buf, idx, modelName: model.name };
  })();

  try {
    return await Promise.race([fetchTask, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Muat turun TTS dengan auto-fallback PANTAS:
 * 1. Cuba model utama yang paling stabil dahulu (had 2.2s)
 * 2. Jika gagal/lambat, lumba semua model alternatif SECARA SELARI (Promise.any, had 2.5s)
 */
async function fetchTtsWithFallback(text, lang, outPath) {
  const cleanText = String(text || '').trim().slice(0, 180);
  if (!cleanText) return { ok: false, modelName: null };

  const primaryIdx = preferredTtsModelIndex % TTS_MODELS.length;
  try {
    const primary = await trySingleTtsModel(
      TTS_MODELS[primaryIdx],
      primaryIdx,
      cleanText,
      lang,
      2200
    );
    fs.writeFileSync(outPath, primary.buf);
    return { ok: true, modelName: primary.modelName };
  } catch {
    // Lumba model alternatif secara selari — siapa paling cepat berjaya terus menang!
    const fallbacks = TTS_MODELS.map((m, idx) => ({ m, idx })).filter(
      (x) => x.idx !== primaryIdx
    );

    try {
      const winner = await Promise.any(
        fallbacks.map((x) => trySingleTtsModel(x.m, x.idx, cleanText, lang, 2500))
      );
      preferredTtsModelIndex = winner.idx;
      fs.writeFileSync(outPath, winner.buf);
      return { ok: true, modelName: winner.modelName };
    } catch {
      return { ok: false, modelName: null };
    }
  }
}

/**
 * Muat turun klip audio sebenar (Deezer/iTunes preview) dan tukar pantas ke OGG Opus.
 */
async function buildRealAudioClipOgg(previewUrl) {
  ensureTmpDir();
  const id = crypto.randomBytes(6).toString('hex');
  const rawPath = path.join(config.TMP_DIR, `preview-${id}.audio`);
  const outOgg = path.join(config.TMP_DIR, `clip-${id}.ogg`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(previewUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BotNyanyiWhatsApp/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength < 2048) throw new Error('Fail pratonton terlalu kecil');
    fs.writeFileSync(rawPath, Buffer.from(arrayBuf));

    await runFfmpeg(
      [
        '-i', rawPath,
        '-t', '25',
        '-af', 'afade=t=in:st=0:d=0.3,afade=t=out:st=23:d=1.8',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-application', 'voip',
        outOgg,
      ],
      10000
    );

    return fs.readFileSync(outOgg);
  } finally {
    safeUnlink(rawPath);
    safeUnlink(outOgg);
  }
}

/**
 * Bina audio melodi instrumental pantas (<1 saat) — digunakan sebagai mod pantas atau
 * fallback terakhir jika semua model TTS atas talian tidak dapat dihubungi.
 */
async function buildFastInstrumentalOgg(songResult) {
  ensureTmpDir();
  const id = crypto.randomBytes(6).toString('hex');
  const backingWav = path.join(config.TMP_DIR, `fast-${id}.wav`);
  const outOgg = path.join(config.TMP_DIR, `fast-${id}.ogg`);

  try {
    const melodySong = songResult.melodySong;
    const phrases = songResult.phrases || melodySong.phrases;
    synthesizeBackingTrack(melodySong, phrases, backingWav);

    await runFfmpeg(
      [
        '-i', backingWav,
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-application', 'audio',
        outOgg,
      ],
      8000
    );

    return {
      buffer: fs.readFileSync(outOgg),
      usedVocal: false,
      modelUsed: 'Model Instrumental Pantas (Tempatan)',
    };
  } finally {
    safeUnlink(backingWav);
    safeUnlink(outOgg);
  }
}

/**
 * Sintesis nyanyian bot PANTAS (satu laluan FFmpeg sahaja + muat turun TTS selari):
 * 1. Jana trek iringan melodi sebenar (WAV tempatan, <50ms)
 * 2. Muat turun semua frasa TTS SECARA SELARI dengan auto-fallback 4 model TTS
 * 3. Gabungkan pelarasan pic + adelay + adunan muzik + enkoding OGG Opus dalam 1 arahan FFmpeg!
 */
async function buildBotSingingOgg(songResult) {
  ensureTmpDir();
  const id = crypto.randomBytes(6).toString('hex');
  const tempFiles = [];

  const backingWav = path.join(config.TMP_DIR, `backing-${id}.wav`);
  const outOgg = path.join(config.TMP_DIR, `sing-${id}.ogg`);
  tempFiles.push(backingWav, outOgg);

  try {
    const melodySong = songResult.melodySong;
    const phrases = songResult.phrases || melodySong.phrases;
    const lang = melodySong.lang || 'ms';

    // 1. Bina trek iringan melodi sebenar
    const backing = synthesizeBackingTrack(melodySong, phrases, backingWav);

    // 2. Muat turun suara TTS untuk semua frasa SECARA SELARI (jimat 4x masa!)
    const baseMidi = 65; // F4
    const ttsJobs = backing.phrases.map(async (pm, idx) => {
      const mp3Path = path.join(config.TMP_DIR, `tts-${id}-${idx}.mp3`);
      tempFiles.push(mp3Path);

      const res = await fetchTtsWithFallback(pm.text, lang, mp3Path);
      if (!res.ok) return null;

      const validNotes = (pm.notes || []).filter((n) => n.midi != null);
      const avgMidi = validNotes.length
        ? validNotes.reduce((acc, n) => acc + n.midi, 0) / validNotes.length
        : baseMidi;

      // Pelarasan pic halus mengikut melodi frasa supaya kedengaran menyanyi & tetap jelas
      const semitoneDelta = Math.max(-3.5, Math.min(4.5, (avgMidi - baseMidi) * 0.7));
      const pitchRatio = Math.pow(2, semitoneDelta / 12);

      return {
        path: mp3Path,
        delayMs: Math.max(0, Math.round(pm.startSec * 1000)),
        pitchRatio,
        modelName: res.modelName,
      };
    });

    const resolvedVocals = (await Promise.all(ttsJobs)).filter(Boolean);

    // 3. SATU panggilan FFmpeg sahaja untuk pitch-shift semua frasa + campur muzik -> OGG Opus
    if (resolvedVocals.length > 0) {
      const inputs = ['-i', backingWav];
      const filterParts = ['[0:a]volume=0.46[bg]'];
      const mixLabels = ['[bg]'];

      resolvedVocals.forEach((voc, idx) => {
        inputs.push('-i', voc.path);
        const inIdx = idx + 1;
        const targetRate = Math.round(44100 * voc.pitchRatio);
        // Imbangi perubahan kelajuan daripada asetrate dengan atempo songsang (clamped 0.72..1.38)
        const compensateTempo = Math.max(0.72, Math.min(1.38, 1 / voc.pitchRatio));
        filterParts.push(
          `[${inIdx}:a]aresample=44100,asetrate=${targetRate},aresample=44100,` +
            `atempo=${compensateTempo.toFixed(3)},highpass=f=130,lowpass=f=4800,` +
            `aecho=0.8:0.85:36:0.2,adelay=${voc.delayMs}|${voc.delayMs},volume=1.55[v${idx}]`
        );
        mixLabels.push(`[v${idx}]`);
      });

      filterParts.push(
        `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]`
      );

      try {
        await runFfmpeg(
          [
            ...inputs,
            '-filter_complex', filterParts.join(';'),
            '-map', '[out]',
            '-ac', '1',
            '-ar', '48000',
            '-c:a', 'libopus',
            '-b:a', '48k',
            '-application', 'audio',
            outOgg,
          ],
          14000
        );

        return {
          buffer: fs.readFileSync(outOgg),
          usedVocal: true,
          modelUsed: resolvedVocals[0].modelName,
        };
      } catch {
        // Jika adunan kompleks gagal/timeout pada CPU rendah, fallback terus ke instrumental pantas
      }
    }

    // Fallback akhir: instrumental melodi sebenar (pasti berjaya & pantas)
    await runFfmpeg(
      [
        '-i', backingWav,
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '48k',
        outOgg,
      ],
      8000
    );

    return {
      buffer: fs.readFileSync(outOgg),
      usedVocal: false,
      modelUsed: 'Model Instrumental Pantas (Fallback Automatik)',
    };
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

/**
 * Titik masuk utama penjana audio nyanyian hibrid dengan auto-fallback berbilang model.
 */
async function generateSingingAudio(songResult, options = {}) {
  // Mod pantas eksplisit (/nyanyi cepat atau /nyanyi melodi)
  if (options.fastMode) {
    const fast = await buildFastInstrumentalOgg(songResult);
    return {
      buffer: fast.buffer,
      actualMode: songResult.found ? 'real_melody_fast' : 'adapted_fast',
      usedVocal: false,
      modelUsed: fast.modelUsed,
    };
  }

  // Model 1: Klip audio lagu sebenar (Deezer / iTunes)
  if (songResult.mode === 'real_audio_clip' && songResult.previewUrl) {
    try {
      const buffer = await buildRealAudioClipOgg(songResult.previewUrl);
      return {
        buffer,
        actualMode: 'real_audio_clip',
        usedVocal: true,
        modelUsed: 'Klip Audio Sebenar (Deezer/iTunes)',
      };
    } catch {
      // Auto-tukar ke model nyanyian bot jika klip gagal/lambat
    }
  }

  // Model 2-4: Nyanyian suara bot (auto-fallback TTS Model A -> B -> C -> D -> Instrumental Pantas)
  const synth = await buildBotSingingOgg(songResult);
  return {
    buffer: synth.buffer,
    actualMode: songResult.found ? 'real_melody_bot_sing' : 'adapted_bot_sing',
    usedVocal: synth.usedVocal,
    modelUsed: synth.modelUsed,
  };
}

module.exports = {
  generateSingingAudio,
  buildBotSingingOgg,
  buildRealAudioClipOgg,
  buildFastInstrumentalOgg,
  getFfmpegPath,
};
