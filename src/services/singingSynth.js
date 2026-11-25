const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const { synthesizeBackingTrack } = require('./melodySynth');
const { fetchRealAudioFile } = require('./youtubeAudio');
const { extractMelodyContour } = require('./pitchExtractor');

const execFileAsync = promisify(execFile);

let cachedFfmpegPath = null;

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

const TTS_MODELS = [
  {
    name: 'Model Vokal A (Google TTS)',
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
    name: 'Model Vokal B (Google APIs)',
    buildUrl: (text, lang) =>
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile',
    },
  },
  {
    name: 'Model Vokal C (Google Dict)',
    buildUrl: (text, lang) =>
      `https://translate.google.com/translate_tts?ie=UTF-8&client=dict-chrome-ex&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  },
  {
    name: 'Model Vokal D (StreamElements)',
    buildUrl: (text) =>
      `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`,
    headers: {
      'User-Agent': 'BotNyanyiWhatsApp/1.0',
    },
  },
];

let preferredTtsModelIndex = 0;

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
 * Tukar fail audio asal (YouTube/Deezer/iTunes) terus kepada Voice Note OGG Opus (/nyanyi asal).
 */
async function convertRawAudioToVoiceNote(rawPath) {
  ensureTmpDir();
  const outOgg = path.join(config.TMP_DIR, `orig-${crypto.randomBytes(5).toString('hex')}.ogg`);
  try {
    await runFfmpeg(
      [
        '-i', rawPath,
        '-t', '25',
        '-af', 'afade=t=in:st=0:d=0.3,afade=t=out:st=23:d=1.8',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '56k',
        '-application', 'audio',
        outOgg,
      ],
      10000
    );
    return fs.readFileSync(outOgg);
  } finally {
    safeUnlink(outOgg);
  }
}

/**
 * ENJIN TIRU IRAMA SEBENAR YOUTUBE:
 * 1. Ambil audio sebenar daripada YouTube (utamakan Karaoke/Instrumental untuk iringan,
 *    dan audio lagu asal untuk mengekstrak kontur pic F0 sebenar).
 * 2. Ekstrak lengkuk pic F0 & masa mula nyanyian daripada audio sebenar.
 * 3. Muat turun suara TTS lirik sebenar secara selari -> laras pic ikut kontur F0 YouTube ->
 *    adun di atas irama sebenar YouTube dalam 1 arahan FFmpeg!
 */
async function buildYouTubeImitatedSingingOgg(songResult) {
  ensureTmpDir();
  const id = crypto.randomBytes(5).toString('hex');
  const tempFiles = [];
  const outOgg = path.join(config.TMP_DIR, `yt-sing-${id}.ogg`);
  tempFiles.push(outOgg);

  try {
    const ffmpegPath = getFfmpegPath();
    const karaokeId = songResult.youtubeKaraokeVideo?.videoId || null;
    const songId = songResult.youtubeSongVideo?.videoId || null;
    const previewUrl = songResult.previewUrl || null;

    // Muat turun audio rujukan (karaoke jika ada, atau lagu asal / preview)
    const [karaokeAudio, refAudio] = await Promise.all([
      karaokeId ? fetchRealAudioFile({ videoId: karaokeId }) : Promise.resolve(null),
      fetchRealAudioFile({ videoId: songId, previewUrl }),
    ]);

    if (karaokeAudio?.path) tempFiles.push(karaokeAudio.path);
    if (refAudio?.path) tempFiles.push(refAudio.path);

    const backingPath = karaokeAudio?.path || refAudio?.path;
    if (!backingPath) return null; // Biar jatuh balik ke enjin melodi tempatan

    const phrases = (songResult.phrases || songResult.melodySong.phrases || []).slice(0, 4);
    const lang = songResult.melodySong?.lang || 'ms';

    // Ekstrak kontur pic F0 SEBENAR daripada audio lagu asal (atau karaoke)
    const pitchSourcePath = refAudio?.path || karaokeAudio?.path;
    const contour = await extractMelodyContour(pitchSourcePath, ffmpegPath, phrases.length);

    // Muat turun TTS semua baris lirik SECARA SELARI
    const ttsJobs = phrases.map(async (p, idx) => {
      const mp3Path = path.join(config.TMP_DIR, `yttts-${id}-${idx}.mp3`);
      tempFiles.push(mp3Path);
      const res = await fetchTtsWithFallback(p.text, lang, mp3Path);
      if (!res.ok) return null;

      const seg = contour?.segments?.[idx];
      const startSec = seg ? seg.startSec : 0.8 + idx * 3.8;
      const relSemitones = seg ? seg.relSemitones : 0;
      const pitchRatio = Math.pow(2, relSemitones / 12);

      return {
        path: mp3Path,
        delayMs: Math.max(0, Math.round(startSec * 1000)),
        pitchRatio,
        modelName: res.modelName,
      };
    });

    const resolvedVocals = (await Promise.all(ttsJobs)).filter(Boolean);
    if (!resolvedVocals.length) {
      // Jika TTS gagal, hantar audio sebenar YouTube/preview terus supaya pengguna tetap dengar irama sebenar!
      const buf = await convertRawAudioToVoiceNote(backingPath);
      return {
        buffer: buf,
        actualMode: 'real_audio_clip',
        usedVocal: true,
        modelUsed: karaokeAudio ? `Irama Karaoke ${karaokeAudio.source}` : `Audio Sebenar ${refAudio.source}`,
      };
    }

    // Jika iringan ialah Karaoke YouTube sebenar -> kekalkan penuh jernih (volume=0.58)
    // Jika iringan ialah lagu asal YouTube (tiada karaoke) -> lembutkan frekuensi vokal asal
    // dengan penapis lembut (eq mid-dip) supaya irama/instrumen asal jelas dan nyanyian bot kedengaran di hadapan!
    const backingFilter = karaokeAudio
      ? '[0:a]atrim=0:24,asetpts=PTS-STARTPTS,volume=0.58[bg]'
      : '[0:a]atrim=0:24,asetpts=PTS-STARTPTS,equalizer=f=1200:t=q:w=1.2:g=-6,equalizer=f=2600:t=q:w=1.2:g=-5,volume=0.45[bg]';

    const inputs = ['-i', backingPath];
    const filterParts = [backingFilter];
    const mixLabels = ['[bg]'];

    resolvedVocals.forEach((voc, idx) => {
      inputs.push('-i', voc.path);
      const inIdx = idx + 1;
      const targetRate = Math.round(44100 * voc.pitchRatio);
      const compTempo = Math.max(0.75, Math.min(1.35, 1 / voc.pitchRatio));
      filterParts.push(
        `[${inIdx}:a]aresample=44100,asetrate=${targetRate},aresample=44100,` +
          `atempo=${compTempo.toFixed(3)},highpass=f=140,lowpass=f=4800,` +
          `aecho=0.8:0.85:35:0.2,adelay=${voc.delayMs}|${voc.delayMs},volume=1.65[v${idx}]`
      );
      mixLabels.push(`[v${idx}]`);
    });

    filterParts.push(
      `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,afade=t=out:st=22:d=1.8,alimiter=limit=0.95[out]`
    );

    await runFfmpeg(
      [
        ...inputs,
        '-filter_complex', filterParts.join(';'),
        '-map', '[out]',
        '-t', '24',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '56k',
        '-application', 'audio',
        outOgg,
      ],
      15000
    );

    const backingLabel = karaokeAudio
      ? `Karaoke ${karaokeAudio.source}`
      : `Irama ${refAudio.source}`;

    return {
      buffer: fs.readFileSync(outOgg),
      actualMode: 'youtube_imitate_sing',
      usedVocal: true,
      modelUsed: `${resolvedVocals[0].modelName} + Tiru Pic F0 (${backingLabel})`,
    };
  } catch {
    return null;
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

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

    const backing = synthesizeBackingTrack(melodySong, phrases, backingWav);
    const baseMidi = 65;

    const ttsJobs = backing.phrases.map(async (pm, idx) => {
      const mp3Path = path.join(config.TMP_DIR, `tts-${id}-${idx}.mp3`);
      tempFiles.push(mp3Path);

      const res = await fetchTtsWithFallback(pm.text, lang, mp3Path);
      if (!res.ok) return null;

      const validNotes = (pm.notes || []).filter((n) => n.midi != null);
      const avgMidi = validNotes.length
        ? validNotes.reduce((acc, n) => acc + n.midi, 0) / validNotes.length
        : baseMidi;

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

    if (resolvedVocals.length > 0) {
      const inputs = ['-i', backingWav];
      const filterParts = ['[0:a]volume=0.46[bg]'];
      const mixLabels = ['[bg]'];

      resolvedVocals.forEach((voc, idx) => {
        inputs.push('-i', voc.path);
        const inIdx = idx + 1;
        const targetRate = Math.round(44100 * voc.pitchRatio);
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
        // fallback instrumental
      }
    }

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
 * Titik masuk utama penjana audio nyanyian:
 * 1. Mod pantas (/nyanyi cepat) -> Instrumental tempatan (<0.5s)
 * 2. Mod klip asal (/nyanyi asal) -> Audio YouTube / Deezer / iTunes asal
 * 3. Mod lalai (/nyanyi) bila lagu sebenar ditemui -> Ambil irama YouTube + ekstrak pic F0 + bot nyanyi tiru irama!
 * 4. Fallback automatik -> Sintesis melodi & vokal tempatan (auto-tukar 4 model TTS -> Instrumental)
 */
async function generateSingingAudio(songResult, options = {}) {
  if (options.fastMode) {
    const fast = await buildFastInstrumentalOgg(songResult);
    return {
      buffer: fast.buffer,
      actualMode: songResult.found ? 'real_melody_fast' : 'adapted_fast',
      usedVocal: false,
      modelUsed: fast.modelUsed,
    };
  }

  // Mod audio asal terus daripada YouTube / Deezer / iTunes (/nyanyi asal)
  if (options.originalClip || songResult.mode === 'real_audio_clip') {
    const raw = await fetchRealAudioFile({
      videoId: songResult.youtubeSongVideo?.videoId,
      previewUrl: songResult.previewUrl,
    });
    if (raw?.path) {
      try {
        const buffer = await convertRawAudioToVoiceNote(raw.path);
        return {
          buffer,
          actualMode: 'real_audio_clip',
          usedVocal: true,
          modelUsed: `Audio Lagu Sebenar (${raw.source})`,
        };
      } finally {
        safeUnlink(raw.path);
      }
    }
  }

  // Mod utama apabila lagu sebenar ditemui: ambil irama sebenar YouTube, ekstrak pic F0, & nyanyi tiru irama!
  if (
    songResult.found &&
    !options.forceLocalSynth &&
    (songResult.youtubeKaraokeVideo || songResult.youtubeSongVideo || songResult.previewUrl)
  ) {
    const ytImitated = await buildYouTubeImitatedSingingOgg(songResult);
    if (ytImitated) return ytImitated;
  }

  // Fallback / Lirik suai padan: sintesis melodi sebenar + vokal TTS multi-model
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
  buildYouTubeImitatedSingingOgg,
  buildBotSingingOgg,
  buildFastInstrumentalOgg,
  getFfmpegPath,
};
