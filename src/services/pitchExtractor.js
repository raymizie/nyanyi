const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);

function freqToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Pengesan pic F0 (Normalized Autocorrelation / YIN ringkas) untuk satu bingkai audio 16kHz.
 * Julat vokal nyanyian: 110 Hz (A2) hingga 660 Hz (E5).
 */
function detectFramePitchHz(samples, offset, frameSize, sampleRate) {
  const minLag = Math.floor(sampleRate / 660); // ~24
  const maxLag = Math.floor(sampleRate / 110); // ~145
  if (offset + frameSize + maxLag >= samples.length) return null;

  // Semak tenaga RMS dahulu (abaikan bahagian senyap)
  let energy = 0;
  for (let i = 0; i < frameSize; i++) {
    const s = samples[offset + i];
    energy += s * s;
  }
  const rms = Math.sqrt(energy / frameSize);
  if (rms < 0.025) return null;

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let den1 = 0;
    let den2 = 0;
    for (let i = 0; i < frameSize; i += 2) {
      const a = samples[offset + i];
      const b = samples[offset + i + lag];
      num += a * b;
      den1 += a * a;
      den2 += b * b;
    }
    const denom = Math.sqrt(den1 * den2);
    if (denom < 1e-6) continue;
    const corr = num / denom;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && bestCorr >= 0.58) {
    return sampleRate / bestLag;
  }
  return null;
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Ekstrak kontur pic melodi sebenar (F0) dan masa mula nyanyian (onsetSec) daripada
 * fail audio YouTube / Deezer / iTunes sebenar.
 *
 * @param {string} audioFilePath - Fail audio asal yang dimuat turun
 * @param {string} ffmpegPath - Laluan binary ffmpeg
 * @param {number} numSegments - Bilangan segmen frasa lirik yang mahu dipadankan
 */
async function extractMelodyContour(audioFilePath, ffmpegPath, numSegments = 6) {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const pcmPath = path.join(config.TMP_DIR, `pcm-${crypto.randomBytes(5).toString('hex')}.raw`);
  const sampleRate = 16000;

  try {
    // Dekod 24 saat pertama kepada PCM 16kHz mono + penapis julat vokal (120Hz..2200Hz)
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-loglevel', 'error',
        '-i', audioFilePath,
        '-t', '24',
        '-af', 'highpass=f=120,lowpass=f=2200',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-f', 's16le',
        pcmPath,
      ],
      { timeout: 8000 }
    );

    const rawBuf = fs.readFileSync(pcmPath);
    const totalSamples = Math.floor(rawBuf.length / 2);
    if (totalSamples < sampleRate * 2) return null;

    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = rawBuf.readInt16LE(i * 2) / 32768;
    }

    const totalSec = totalSamples / sampleRate;

    // 1. Kesan masa mula muzik/vokal sebenar (elak bahagian senyap awal video YouTube)
    let onsetSec = 0.4;
    const stepSamples = Math.floor(sampleRate * 0.1);
    for (let idx = 0; idx < totalSamples - stepSamples; idx += stepSamples) {
      let sum = 0;
      for (let j = 0; j < stepSamples; j += 4) {
        const v = samples[idx + j];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / (stepSamples / 4));
      if (rms > 0.045) {
        onsetSec = Math.max(0.25, idx / sampleRate);
        break;
      }
    }

    // 2. Kesan kontur pic F0 pada setiap 80ms dari onsetSec hingga tamat
    const frameSize = 640; // 40ms
    const hopSize = 1280; // 80ms
    const startSample = Math.floor(onsetSec * sampleRate);
    const allMidis = [];
    const frames = [];

    for (let pos = startSample; pos < totalSamples - frameSize - 160; pos += hopSize) {
      const hz = detectFramePitchHz(samples, pos, frameSize, sampleRate);
      const timeSec = pos / sampleRate;
      if (hz) {
        const midi = freqToMidi(hz);
        allMidis.push(midi);
        frames.push({ timeSec, midi });
      }
    }

    const songMedianMidi = median(allMidis) || 64;
    const usableDur = Math.max(4, Math.min(20, totalSec - onsetSec - 0.5));
    const segDur = usableDur / Math.max(1, numSegments);

    // 3. Bina sasaran pic melodi & masa bagi setiap segmen frasa
    const segments = [];
    for (let i = 0; i < numSegments; i++) {
      const segStart = onsetSec + i * segDur;
      const segEnd = segStart + segDur;
      const segMidis = frames
        .filter((f) => f.timeSec >= segStart && f.timeSec < segEnd)
        .map((f) => f.midi);

      const segMedian = median(segMidis);
      // Bezakan pic relatif terhadap kunci lagu sebenar (semiton)
      const relSemitones =
        segMedian != null
          ? Math.max(-4.5, Math.min(5.0, (segMedian - songMedianMidi) * 0.85))
          : 0;

      segments.push({
        startSec: segStart,
        durationSec: segDur,
        midi: segMedian ?? songMedianMidi,
        relSemitones,
        voicedFrames: segMidis.length,
      });
    }

    return {
      totalSec,
      onsetSec,
      medianMidi: songMedianMidi,
      voicedCount: allMidis.length,
      segments,
    };
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    } catch {
      // ignore
    }
  }
}

module.exports = {
  extractMelodyContour,
};
