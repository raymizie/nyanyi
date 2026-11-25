const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const { fetchRealAudioFile } = require('./youtubeAudio');
const { generateRealAiSong } = require('./aiSingingEngine');
const { synthesizeBackingTrack } = require('./melodySynth');
const { detectVocalStartSec } = require('./pitchExtractor');

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

async function runFfmpeg(args, timeoutMs = 18000) {
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
 * Tukar audio studio kepada WhatsApp Voice Note OGG Opus 96kbps sambil MELANGKAU INTRO PANJANG
 * secara automatik (menggunakan timestamp lirik LRCLIB atau pengesan vokal `detectVocalStartSec`)
 * supaya klip terus mula tepat pada bahagian nyanyian lirik!
 */
async function convertStudioAudioToVoiceNote(inputPath, { maxSeconds = 27, skipIntro = true } = {}) {
  ensureTmpDir();
  const outOgg = path.join(config.TMP_DIR, `studio-${crypto.randomBytes(5).toString('hex')}.ogg`);

  let trimStartSec = 0;
  if (skipIntro) {
    trimStartSec = await detectVocalStartSec(inputPath, getFfmpegPath(), 60);
  }

  const fadeOutStart = Math.max(5, maxSeconds - 2);
  const inputArgs = trimStartSec > 0.5 ? ['-ss', String(trimStartSec), '-i', inputPath] : ['-i', inputPath];

  try {
    await runFfmpeg(
      [
        ...inputArgs,
        '-t', String(maxSeconds),
        '-af', `loudnorm=I=-14:TP=-1.2:LRA=11,afade=t=in:st=0:d=0.2,afade=t=out:st=${fadeOutStart}:d=1.6`,
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '96k',
        '-application', 'audio',
        outOgg,
      ],
      14000
    );
    return {
      buffer: fs.readFileSync(outOgg),
      trimmedStartSec: trimStartSec,
    };
  } finally {
    safeUnlink(outOgg);
  }
}

/**
 * Fallback vokal jika kedua-dua pelayan AI (ACE-Step & DiffRhythm) sedang penuh barisan:
 * Guna Edge Neural Melayu (YasminNeural) dahulu, jika gagal baru Google TTS,
 * di atas trek karaoke/iringan sebenar YouTube (BUKAN MIDI jika ada karaoke!).
 */
async function fetchBestFallbackVocal(text, lang, outPath) {
  const clean = String(text || '').trim().slice(0, 180);
  if (!clean) return null;

  // 1. Cuba Microsoft Edge Neural Voice (suara manusia Melayu berkualiti tinggi)
  try {
    const { EdgeTTS } = await import('edge-tts-universal');
    const voice = lang === 'en' ? 'en-US-JennyNeural' : 'ms-MY-YasminNeural';
    const tts = new EdgeTTS(clean, voice, { rate: '+2%', pitch: '+6Hz' });
    const res = await Promise.race([
      tts.synthesize(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('edge timeout')), 4500)),
    ]);
    const buf = Buffer.from(await res.audio.arrayBuffer());
    if (buf.length > 500) {
      fs.writeFileSync(outPath, buf);
      return 'Suara Neural Melayu (YasminNeural)';
    }
  } catch {
    // fallback ke Google TTS
  }

  // 2. Fallback Google TTS
  for (const client of ['tw-ob', 'gtx']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=${client}&tl=${encodeURIComponent(
        lang
      )}&q=${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 400) {
        fs.writeFileSync(outPath, buf);
        return 'Suara Sandaran TTS';
      }
    } catch {
      clearTimeout(timer);
    }
  }

  return null;
}

async function buildEmergencyFallbackOgg(songResult) {
  ensureTmpDir();
  const id = crypto.randomBytes(5).toString('hex');
  const tempFiles = [];
  const outOgg = path.join(config.TMP_DIR, `fb-${id}.ogg`);
  tempFiles.push(outOgg);

  try {
    // Cuba dapatkan trek karaoke/iringan sebenar YouTube/preview dahulu sebelum sentuh sintesis tempatan
    let backingPath = null;
    let backingLabel = 'Irama Tempatan';

    const realBacking = await fetchRealAudioFile({
      videoId: songResult.youtubeKaraokeVideo?.videoId || songResult.youtubeSongVideo?.videoId,
      previewUrl: songResult.previewUrl,
    });

    if (realBacking?.path) {
      backingPath = realBacking.path;
      backingLabel = realBacking.source;
      tempFiles.push(backingPath);
    } else {
      const wavPath = path.join(config.TMP_DIR, `bk-${id}.wav`);
      synthesizeBackingTrack(songResult.melodySong, songResult.phrases || songResult.melodySong.phrases, wavPath);
      backingPath = wavPath;
      tempFiles.push(wavPath);
    }

    const phrases = (songResult.phrases || songResult.melodySong.phrases || []).slice(0, 4);
    const lang = songResult.melodySong?.lang || 'ms';

    const vocalResults = await Promise.all(
      phrases.map(async (p, idx) => {
        const mp3 = path.join(config.TMP_DIR, `v-${id}-${idx}.mp3`);
        tempFiles.push(mp3);
        const name = await fetchBestFallbackVocal(p.text, lang, mp3);
        return name ? { path: mp3, delayMs: 800 + idx * 4200, name } : null;
      })
    );
    const vocals = vocalResults.filter(Boolean);

    if (vocals.length > 0) {
      const inputs = ['-i', backingPath];
      const filters = ['[0:a]atrim=0:22,asetpts=PTS-STARTPTS,volume=0.42[bg]'];
      const mix = ['[bg]'];

      vocals.forEach((v, idx) => {
        inputs.push('-i', v.path);
        filters.push(
          `[${idx + 1}:a]aresample=44100,highpass=f=120,aecho=0.8:0.85:35:0.2,adelay=${v.delayMs}|${v.delayMs},volume=1.55[v${idx}]`
        );
        mix.push(`[v${idx}]`);
      });

      filters.push(
        `${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]`
      );

      await runFfmpeg(
        [
          ...inputs,
          '-filter_complex', filters.join(';'),
          '-map', '[out]',
          '-t', '22',
          '-ac', '1',
          '-ar', '48000',
          '-c:a', 'libopus',
          '-b:a', '80k',
          outOgg,
        ],
        12000
      );

      return {
        buffer: fs.readFileSync(outOgg),
        actualMode: 'fallback_vocal',
        usedVocal: true,
        modelUsed: `${vocals[0].name} + ${backingLabel}`,
      };
    }

    const converted = await convertStudioAudioToVoiceNote(backingPath, {
      maxSeconds: 22,
      skipIntro: false,
    });
    return {
      buffer: converted.buffer,
      actualMode: 'fallback_instrumental',
      usedVocal: false,
      modelUsed: backingLabel,
    };
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

/**
 * ENJIN AUDIO UTAMA — TERUS MASUK NYANYIAN LIRIK (LANGKAU INTRO PANJANG!)
 */
async function generateSingingAudio(songResult, options = {}) {
  const wantAiCover = Boolean(options.forceAiSing);

  // LALUAN 1: LAGU SEBENAR DITEMUI -> LOMPAT TERUS KE BAHAGIAN NYANYIAN LIRIK!
  if (songResult.found && !wantAiCover) {
    const realAudio = await fetchRealAudioFile({
      videoId: songResult.youtubeSongVideo?.videoId,
      previewUrl: songResult.previewUrl,
      startSec: songResult.vocalStartSec,
    });

    if (realAudio?.path) {
      try {
        const converted = await convertStudioAudioToVoiceNote(realAudio.path, {
          maxSeconds: 27,
          // Jika yt-dlp sudah potong tepat pada timestamp lirik LRCLIB, tak perlu potong 2 kali
          skipIntro: !realAudio.alreadyCutAtStartSec,
        });
        return {
          buffer: converted.buffer,
          actualMode: 'real_song',
          usedVocal: true,
          skippedIntroSec: realAudio.alreadyCutAtStartSec
            ? songResult.vocalStartSec
            : converted.trimmedStartSec,
          modelUsed: `Lagu Sebenar (${realAudio.source})`,
        };
      } finally {
        safeUnlink(realAudio.path);
      }
    }
  }

  // LALUAN 2: NYANYIAN AI STUDIO PENUH (ACE-Step v1.5 -> YuE2-3B)
  let refAudioPath = null;
  try {
    if (wantAiCover && (songResult.youtubeSongVideo?.videoId || songResult.previewUrl)) {
      const ref = await fetchRealAudioFile({
        videoId: songResult.youtubeSongVideo?.videoId,
        previewUrl: songResult.previewUrl,
        startSec: songResult.vocalStartSec,
      });
      if (ref?.path) refAudioPath = ref.path;
    }

    const aiSong = await generateRealAiSong(songResult, {
      durationSec: 20,
      refAudioPath,
    });

    if (aiSong?.path) {
      try {
        const converted = await convertStudioAudioToVoiceNote(aiSong.path, {
          maxSeconds: 25,
          skipIntro: true,
        });
        return {
          buffer: converted.buffer,
          actualMode: 'ai_studio_sing',
          usedVocal: true,
          skippedIntroSec: converted.trimmedStartSec,
          modelUsed: aiSong.modelName,
        };
      } finally {
        safeUnlink(aiSong.path);
      }
    }
  } finally {
    if (refAudioPath) safeUnlink(refAudioPath);
  }

  return await buildEmergencyFallbackOgg(songResult);
}

module.exports = {
  generateSingingAudio,
  convertStudioAudioToVoiceNote,
  getFfmpegPath,
};
