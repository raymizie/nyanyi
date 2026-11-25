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

async function runFfmpeg(args) {
  const ffmpeg = getFfmpegPath();
  await execFileAsync(ffmpeg, ['-y', ...args], {
    timeout: 45000,
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
 * Muat turun klip audio sebenar (Deezer/iTunes preview) dan tukar ke WhatsApp Voice Note OGG Opus.
 */
async function buildRealAudioClipOgg(previewUrl) {
  ensureTmpDir();
  const id = crypto.randomBytes(6).toString('hex');
  const rawPath = path.join(config.TMP_DIR, `preview-${id}.audio`);
  const outOgg = path.join(config.TMP_DIR, `clip-${id}.ogg`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(previewUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BotNyanyiWhatsApp/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status} muat turun pratonton audio`);

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength < 2048) throw new Error('Fail pratonton audio terlalu kecil');
    fs.writeFileSync(rawPath, Buffer.from(arrayBuf));

    await runFfmpeg([
      '-i', rawPath,
      '-t', '28',
      '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.35,afade=t=out:st=26:d=1.8',
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '64k',
      outOgg,
    ]);

    return fs.readFileSync(outOgg);
  } finally {
    safeUnlink(rawPath);
    safeUnlink(outOgg);
  }
}

/**
 * Dapatkan audio suara TTS percuma (Google Translate TTS, tanpa API key).
 */
async function fetchTtsMp3(text, lang = 'ms', outPath) {
  const cleanText = String(text || '').trim().slice(0, 180);
  if (!cleanText) return false;

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
    lang
  )}&q=${encodeURIComponent(cleanText)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 400) return false;
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bina rantaian penapis `atempo` FFmpeg yang sah (setiap penapis terhad 0.5..2.0).
 */
function buildAtempoChain(speedRatio) {
  const clamped = Math.max(0.55, Math.min(2.6, speedRatio));
  const parts = [];
  let remaining = clamped;

  while (remaining > 2.0) {
    parts.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(',');
}

/**
 * Pecahkan satu frasa lirik kepada 2 segmen sub-frasa supaya pic suara bot
 * naik dan turun mengikut lengkuk melodi sebenar.
 */
function splitPhraseForContour(text) {
  const clean = String(text || '').trim();
  if (clean.includes(',')) {
    const parts = clean
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 3);
  }
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  return [clean];
}

/**
 * Ukur tempoh audio fail menggunakan FFmpeg stderr (tidak perlukan ffprobe).
 */
async function probeDurationSec(filePath) {
  const ffmpeg = getFfmpegPath();
  try {
    await execFileAsync(ffmpeg, ['-i', filePath], { timeout: 8000 });
    return 1.5;
  } catch (err) {
    const stderr = String(err.stderr || '');
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 1.5;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }
}

/**
 * Sintesis nyanyian bot:
 * 1. Jana trek iringan melodi sebenar (WAV)
 * 2. Jana suara TTS setiap segmen frasa, laras pic (pitch shift) ikut nota melodi + laras tempo ikut beat
 * 3. Adun vokal bernada + muzik iringan -> OGG Opus Voice Note WhatsApp
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

    // 2. Bina segmen vokal bernada mengikut kontur melodi
    const vocalSegments = [];
    const baseMidi = 65; // F4 sebagai rujukan tengah vokal semula jadi

    for (let pIdx = 0; pIdx < backing.phrases.length; pIdx++) {
      const pm = backing.phrases[pIdx];
      const subTexts = splitPhraseForContour(pm.text);
      const notes = pm.notes || [];

      for (let sIdx = 0; sIdx < subTexts.length; sIdx++) {
        const subText = subTexts[sIdx];
        const rawMp3 = path.join(config.TMP_DIR, `tts-${id}-${pIdx}-${sIdx}.mp3`);
        const pitchedWav = path.join(config.TMP_DIR, `voc-${id}-${pIdx}-${sIdx}.wav`);
        tempFiles.push(rawMp3, pitchedWav);

        const ok = await fetchTtsMp3(subText, lang, rawMp3);
        if (!ok) continue;

        // Kira tempoh & purata pic melodi untuk segmen ini
        const segStartFrac = sIdx / subTexts.length;
        const segEndFrac = (sIdx + 1) / subTexts.length;
        const segStartSec = pm.startSec + pm.durationSec * segStartFrac;
        const segTargetDur = Math.max(0.65, pm.durationSec * (segEndFrac - segStartFrac) * 0.96);

        const nStart = Math.floor(notes.length * segStartFrac);
        const nEnd = Math.max(nStart + 1, Math.floor(notes.length * segEndFrac));
        const sliceNotes = notes.slice(nStart, nEnd).filter((n) => n.midi != null);
        const avgMidi = sliceNotes.length
          ? sliceNotes.reduce((acc, n) => acc + n.midi, 0) / sliceNotes.length
          : baseMidi;

        // Laras pic dalam julat nyanyian jelas (maks +/- 5 semiton supaya suara tetap jelas & merdu)
        const semitoneDelta = Math.max(-4.5, Math.min(5.5, (avgMidi - baseMidi) * 0.75));
        const pitchRatio = Math.pow(2, semitoneDelta / 12);

        const rawDur = await probeDurationSec(rawMp3);
        // Apabila asetrate menukar pic sebesar pitchRatio, tempoh juga berubah oleh 1/pitchRatio.
        // Maka atempo perlu mengimbangi pitchRatio DAN memadankan segTargetDur.
        const rawDurationAfterPitch = rawDur / pitchRatio;
        const tempoNeeded = Math.max(0.75, Math.min(1.65, rawDurationAfterPitch / segTargetDur));

        const targetRate = Math.round(44100 * pitchRatio);
        const atempoFilter = buildAtempoChain(tempoNeeded);

        const filter = [
          'aresample=44100',
          `asetrate=${targetRate}`,
          'aresample=44100',
          atempoFilter,
          'highpass=f=140',
          'lowpass=f=4800',
          'aecho=0.8:0.85:38:0.22',
          'afade=t=in:st=0:d=0.04',
        ].join(',');

        await runFfmpeg([
          '-i', rawMp3,
          '-af', filter,
          '-ac', '1',
          '-ar', '44100',
          pitchedWav,
        ]);

        vocalSegments.push({
          path: pitchedWav,
          delayMs: Math.max(0, Math.round(segStartSec * 1000)),
        });
      }
    }

    // 3. Adun vokal bernada + iringan melodi -> OGG Opus
    if (vocalSegments.length > 0) {
      const inputs = ['-i', backingWav];
      const filterParts = ['[0:a]volume=0.45[bg]'];
      const mixLabels = ['[bg]'];

      vocalSegments.forEach((seg, idx) => {
        inputs.push('-i', seg.path);
        const inIdx = idx + 1;
        filterParts.push(
          `[${inIdx}:a]adelay=${seg.delayMs}|${seg.delayMs},volume=1.55[v${idx}]`
        );
        mixLabels.push(`[v${idx}]`);
      });

      filterParts.push(
        `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]`
      );

      await runFfmpeg([
        ...inputs,
        '-filter_complex', filterParts.join(';'),
        '-map', '[out]',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '64k',
        outOgg,
      ]);

      return {
        buffer: fs.readFileSync(outOgg),
        usedVocal: true,
      };
    }

    // Fallback luar talian (tiada TTS): hantar instrumental melodi sebenar
    await runFfmpeg([
      '-i', backingWav,
      '-ac', '1',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '64k',
      outOgg,
    ]);

    return {
      buffer: fs.readFileSync(outOgg),
      usedVocal: false,
    };
  } finally {
    for (const f of tempFiles) safeUnlink(f);
  }
}

/**
 * Titik masuk utama penjana audio nyanyian hibrid.
 */
async function generateSingingAudio(songResult) {
  if (songResult.mode === 'real_audio_clip' && songResult.previewUrl) {
    try {
      const buffer = await buildRealAudioClipOgg(songResult.previewUrl);
      return {
        buffer,
        actualMode: 'real_audio_clip',
        usedVocal: true,
      };
    } catch {
      // Fallback automatik ke nyanyian suara bot jika muat turun pratonton gagal
    }
  }

  const synth = await buildBotSingingOgg(songResult);
  return {
    buffer: synth.buffer,
    actualMode: songResult.found ? 'real_melody_bot_sing' : 'adapted_bot_sing',
    usedVocal: synth.usedVocal,
  };
}

module.exports = {
  generateSingingAudio,
  buildBotSingingOgg,
  buildRealAudioClipOgg,
  getFfmpegPath,
};
