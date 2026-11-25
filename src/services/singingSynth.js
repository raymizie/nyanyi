const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const { fetchRealAudioFile } = require('./youtubeAudio');
const { generateRealAiSong } = require('./aiSingingEngine');
const { synthesizeBackingTrack } = require('./melodySynth');
const { analyzeReferenceTrack, detectVocalStartSec } = require('./pitchExtractor');

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
 * Potong audio rujukan sebenar menjadi WAV 20 saat yang BERMULA TEPAT PADA NYANYIAN VOKAL
 * (tiada intro!) supaya apabila dihantar ke AI Studio Cover (`ACE-Step v1.5`),
 * AI mengunci 95% melodi, kord & tempo tepat pada bahagian nyanyian!
 */
async function trimReferenceToVocalWav(inputPath, startSec = 0, durationSec = 20) {
  ensureTmpDir();
  const outWav = path.join(config.TMP_DIR, `refvoc-${crypto.randomBytes(5).toString('hex')}.wav`);
  const inputArgs = startSec > 0.4 ? ['-ss', String(startSec), '-i', inputPath] : ['-i', inputPath];

  await runFfmpeg(
    [
      ...inputArgs,
      '-t', String(durationSec),
      '-ac', '2',
      '-ar', '44100',
      outWav,
    ],
    12000
  );
  return outWav;
}

/**
 * Tukar audio studio kepada WhatsApp Voice Note OGG Opus 96kbps sambil melangkau intro panjang.
 */
async function convertStudioAudioToVoiceNote(inputPath, { maxSeconds = 26, skipIntro = true, knownStartSec = null } = {}) {
  ensureTmpDir();
  const outOgg = path.join(config.TMP_DIR, `studio-${crypto.randomBytes(5).toString('hex')}.ogg`);

  let trimStartSec = knownStartSec != null ? knownStartSec : 0;
  if (skipIntro && knownStartSec == null) {
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

async function fetchBestFallbackVocal(text, lang, outPath) {
  const clean = String(text || '').trim().slice(0, 180);
  if (!clean) return null;

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
    const wavPath = path.join(config.TMP_DIR, `bk-${id}.wav`);
    synthesizeBackingTrack(songResult.melodySong, songResult.phrases || songResult.melodySong.phrases, wavPath);
    tempFiles.push(wavPath);

    const phrases = (songResult.phrases || songResult.melodySong.phrases || []).slice(0, 4);
    const lang = songResult.melodySong?.lang || 'ms';

    const vocalResults = await Promise.all(
      phrases.map(async (p, idx) => {
        const mp3 = path.join(config.TMP_DIR, `v-${id}-${idx}.mp3`);
        tempFiles.push(mp3);
        const name = await fetchBestFallbackVocal(p.text, lang, mp3);
        return name ? { path: mp3, delayMs: 600 + idx * 4000, name } : null;
      })
    );
    const vocals = vocalResults.filter(Boolean);

    if (vocals.length > 0) {
      const inputs = ['-i', wavPath];
      const filters = ['[0:a]atrim=0:20,asetpts=PTS-STARTPTS,volume=0.42[bg]'];
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
          '-t', '20',
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
        modelUsed: `${vocals[0].name} + Irama Sandaran`,
      };
    }

    const converted = await convertStudioAudioToVoiceNote(wavPath, {
      maxSeconds: 20,
      skipIntro: false,
    });
    return {
      buffer: converted.buffer,
      actualMode: 'fallback_instrumental',
      usedVocal: false,
      modelUsed: 'Irama Sandaran Tempatan',
    };
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

/**
 * ENJIN AUDIO UTAMA — ANALISIS IRAMA LAGU SEBENAR & IKUT MELODI 95%–100%!
 *
 * 1. Jika LAGU SEBENAR ditemui:
 *    - Muat turun audio lagu sebenar (YouTube / Studio)
 *    - Analisis BPM sebenar, Kunci Muzik sebenar, dan saat mula vokal (langkau intro!)
 *    - Jika `options.originalOnly` (`/nyanyi asal`): terus hantar klip nyanyian lagu sebenar (100% asal!)
 *    - Jika `options.createMelodyMatch` (lalai `/nyanyi` atau `/nyanyi ai` atau `/nyanyi ikut:<lagu>`):
 *      -> Potong rujukan 20 saat tepat pada vokal (tiada intro!)
 *      -> Hantar ke AI Studio `ACE-Step v1.5` (`/on_cover_click`, `audio_cover_strength: 0.95`,
 *         BPM sebenar + Kunci Muzik sebenar) supaya AI mencipta nyanyian yang SAMA MELODI ~95%!
 *      -> Jika pelayan GPU AI sedang sibuk/habis kuota, fallback serta-merta kepada klip nyanyian
 *         lagu sebenar (100% tepat melodi & suara, BUKAN cipta melodi lari atau MIDI!)
 * 2. Jika TIADA lagu sebenar (mesej rawak tanpa rujukan lagu):
 *    - Cipta lagu penuh dengan AI Studio `ACE-Step v1.5` -> fallback `YuE2-3B`.
 */
async function generateSingingAudio(songResult, options = {}) {
  const originalOnly = Boolean(options.originalOnly);
  const createMelodyMatch = options.createMelodyMatch !== false; // Lalai: cipta ikut melodi 95%!
  const tempFiles = [];

  try {
    // 1. Jika lagu sebenar ditemui (atau pengguna tetapkan lagu rujukan `/nyanyi ikut:<lagu>`)
    if (songResult.found) {
      const realAudio = await fetchRealAudioFile({
        videoId: songResult.youtubeSongVideo?.videoId,
        previewUrl: songResult.previewUrl,
        startSec: songResult.vocalStartSec,
      });

      if (realAudio?.path) {
        tempFiles.push(realAudio.path);

        // Analisis irama lagu sebenar: BPM, Kunci Muzik & saat mula vokal!
        const analysis = await analyzeReferenceTrack(realAudio.path, getFfmpegPath(), 60);
        const effectiveStartSec = realAudio.alreadyCutAtStartSec ? 0 : analysis.vocalStartSec;

        // Mod `/nyanyi asal`: terus hantar audio lagu sebenar (100% asal, tanpa intro!)
        if (originalOnly) {
          const converted = await convertStudioAudioToVoiceNote(realAudio.path, {
            maxSeconds: 26,
            skipIntro: false,
            knownStartSec: effectiveStartSec,
          });
          return {
            buffer: converted.buffer,
            actualMode: 'real_song',
            usedVocal: true,
            analysis,
            skippedIntroSec: realAudio.alreadyCutAtStartSec
              ? songResult.vocalStartSec
              : effectiveStartSec,
            modelUsed: `Lagu Asal (${realAudio.source} • ${analysis.bpm} BPM • ${analysis.keyScale})`,
          };
        }

        // Mod Utama: Cipta nyanyian AI yang MENGUNCI MELODI, BPM & KUNCI LAGU SEBENAR (~95%)!
        if (createMelodyMatch) {
          const refVocalWav = await trimReferenceToVocalWav(realAudio.path, effectiveStartSec, 20);
          tempFiles.push(refVocalWav);

          const aiCover = await generateRealAiSong(songResult, {
            durationSec: 20,
            refAudioPath: refVocalWav,
            analysis,
          });

          if (aiCover?.path) {
            tempFiles.push(aiCover.path);
            const converted = await convertStudioAudioToVoiceNote(aiCover.path, {
              maxSeconds: 22,
              skipIntro: true,
            });
            return {
              buffer: converted.buffer,
              actualMode: 'ai_melody_locked_cover',
              usedVocal: true,
              analysis,
              skippedIntroSec: converted.trimmedStartSec,
              modelUsed: aiCover.modelName,
            };
          }
        }

        // Fallback pintar jika kuota GPU AI sedang penuh: hantar audio lagu sebenar yang sudah dipotong intro!
        // (100% ikut melodi & suara sebenar — TIDAK akan lari melodi!)
        const convertedReal = await convertStudioAudioToVoiceNote(realAudio.path, {
          maxSeconds: 26,
          skipIntro: false,
          knownStartSec: effectiveStartSec,
        });
        return {
          buffer: convertedReal.buffer,
          actualMode: 'real_song_fallback',
          usedVocal: true,
          analysis,
          skippedIntroSec: realAudio.alreadyCutAtStartSec
            ? songResult.vocalStartSec
            : effectiveStartSec,
          modelUsed: `Lagu Sebenar (${realAudio.source} • ${analysis.bpm} BPM • ${analysis.keyScale})`,
        };
      }
    }

    // 2. Teks rawak tanpa lagu sedia ada -> cipta lagu baharu dengan AI Studio
    const aiSong = await generateRealAiSong(songResult, { durationSec: 20 });
    if (aiSong?.path) {
      tempFiles.push(aiSong.path);
      const converted = await convertStudioAudioToVoiceNote(aiSong.path, {
        maxSeconds: 22,
        skipIntro: true,
      });
      return {
        buffer: converted.buffer,
        actualMode: 'ai_studio_sing',
        usedVocal: true,
        skippedIntroSec: converted.trimmedStartSec,
        modelUsed: aiSong.modelName,
      };
    }

    return await buildEmergencyFallbackOgg(songResult);
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

module.exports = {
  generateSingingAudio,
  convertStudioAudioToVoiceNote,
  trimReferenceToVocalWav,
  getFfmpegPath,
};
