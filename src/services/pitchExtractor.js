const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Profil kunci Krumhansl-Schmuckler untuk pengesanan kunci major & minor
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function freqToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function detectFramePitchInfo(samples, offset, frameSize, sampleRate) {
  const minLag = Math.floor(sampleRate / 660);
  const maxLag = Math.floor(sampleRate / 110);
  if (offset + frameSize + maxLag >= samples.length) return null;

  let energy = 0;
  for (let i = 0; i < frameSize; i++) {
    const s = samples[offset + i];
    energy += s * s;
  }
  const rms = Math.sqrt(energy / frameSize);
  if (rms < 0.028) return { rms, corr: 0, hz: null };

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

  return {
    rms,
    corr: bestCorr,
    hz: bestLag > 0 && bestCorr >= 0.56 ? sampleRate / bestLag : null,
  };
}

function estimateBpmFromSamples(samples, sampleRate) {
  // Kira sampul tenaga onset pada resolusi 50Hz (setiap 20ms)
  const hop = Math.floor(sampleRate / 50); // 320 sampel
  const envLen = Math.floor(samples.length / hop);
  if (envLen < 120) return 105;

  const env = new Float32Array(envLen);
  for (let i = 0; i < envLen; i++) {
    let sum = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j += 4) {
      const v = samples[base + j];
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / (hop / 4));
  }

  // Perbezaan positif (onset flux)
  const flux = new Float32Array(envLen);
  for (let i = 1; i < envLen; i++) {
    flux[i] = Math.max(0, env[i] - env[i - 1]);
  }

  // Autokorelasi dalam julat 62–164 BPM (lag 18..48 pada 50Hz)
  const minLag = Math.floor((60 * 50) / 164); // 18
  const maxLag = Math.ceil((60 * 50) / 62); // 49
  let bestLag = 27;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < envLen - lag; i++) {
      acc += flux[i] * flux[i + lag];
    }
    if (acc > bestScore) {
      bestScore = acc;
      bestLag = lag;
    }
  }

  let bpm = Math.round((60 * 50) / bestLag);
  // Elak tempo terlalu laju/perlahan yang tidak semula jadi
  if (bpm < 62) bpm *= 2;
  if (bpm > 164) bpm = Math.round(bpm / 2);
  return Math.max(64, Math.min(160, bpm));
}

function estimateKeyFromChroma(chroma) {
  const sum = chroma.reduce((a, b) => a + b, 0);
  if (sum < 1e-6) return 'C major';

  let bestKey = 'C major';
  let bestCorr = -Infinity;

  for (let root = 0; root < 12; root++) {
    let majScore = 0;
    let minScore = 0;
    for (let i = 0; i < 12; i++) {
      const c = chroma[(root + i) % 12];
      majScore += c * MAJOR_PROFILE[i];
      minScore += c * MINOR_PROFILE[i];
    }
    if (majScore > bestCorr) {
      bestCorr = majScore;
      bestKey = `${NOTE_NAMES[root]} major`;
    }
    if (minScore > bestCorr) {
      bestCorr = minScore;
      bestKey = `${NOTE_NAMES[root]} minor`;
    }
  }

  return bestKey;
}

/**
 * Analisis penuh trek rujukan sebenar:
 * 1. `vocalStartSec`: saat tepat nyanyian bermula (langkau intro panjang)
 * 2. `bpm`: tempo sebenar lagu (64–160 BPM)
 * 3. `keyScale`: kunci muzik sebenar (cth. "E minor", "A major")
 */
async function analyzeReferenceTrack(audioFilePath, ffmpegPath, maxScanSec = 60) {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const pcmPath = path.join(config.TMP_DIR, `ana-${crypto.randomBytes(5).toString('hex')}.raw`);
  const sampleRate = 16000;

  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-loglevel', 'error',
        '-i', audioFilePath,
        '-t', String(maxScanSec),
        '-af', 'highpass=f=100,lowpass=f=3200',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-f', 's16le',
        pcmPath,
      ],
      { timeout: 10000 }
    );

    const rawBuf = fs.readFileSync(pcmPath);
    const totalSamples = Math.floor(rawBuf.length / 2);
    const totalSec = totalSamples / sampleRate;
    if (totalSec < 5) {
      return { vocalStartSec: 0, bpm: 108, keyScale: 'C major', totalSec };
    }

    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = rawBuf.readInt16LE(i * 2) / 32768;
    }

    // 1. Kesan mula vokal + bina histogram kroma pic untuk kunci lagu
    const stepSec = 0.5;
    const stepSamples = Math.floor(sampleRate * stepSec);
    const frameSize = 640;
    const windows = [];
    const chroma = new Float32Array(12);

    for (let pos = 0; pos + stepSamples < totalSamples - 200; pos += stepSamples) {
      let voicedHits = 0;
      let avgRms = 0;
      for (let k = 0; k < 3; k++) {
        const info = detectFramePitchInfo(samples, pos + k * 2400, frameSize, sampleRate);
        if (info) {
          avgRms += info.rms;
          if (info.hz && info.corr >= 0.58) {
            voicedHits++;
            const midi = Math.round(freqToMidi(info.hz));
            const pitchClass = ((midi % 12) + 12) % 12;
            chroma[pitchClass] += info.rms * info.corr;
          }
        }
      }
      avgRms /= 3;
      windows.push({
        sec: pos / sampleRate,
        rms: avgRms,
        voicedHits,
      });
    }

    const sortedRms = windows.map((w) => w.rms).sort((a, b) => a - b);
    const p75 = sortedRms[Math.floor(sortedRms.length * 0.75)] || 0.05;
    const vocalRmsThreshold = Math.max(0.032, p75 * 0.55);
    const maxAllowedStart = Math.max(0, totalSec - 15);

    let vocalStartSec = 0;
    for (let i = 0; i < windows.length - 4; i++) {
      if (windows[i].sec > maxAllowedStart) break;
      let strongCount = 0;
      for (let j = 0; j < 4; j++) {
        const w = windows[i + j];
        if (w.rms >= vocalRmsThreshold && w.voicedHits >= 2) strongCount++;
      }
      if (strongCount >= 3) {
        vocalStartSec = Math.max(0, Number((windows[i].sec - 0.35).toFixed(2)));
        break;
      }
    }

    // 2. Anggar BPM sebenar daripada bahagian nyanyian
    const sliceStart = Math.floor(vocalStartSec * sampleRate);
    const sliceEnd = Math.min(totalSamples, sliceStart + sampleRate * 22);
    const vocalSlice = samples.subarray(sliceStart, sliceEnd);
    const bpm = estimateBpmFromSamples(vocalSlice, sampleRate);
    const keyScale = estimateKeyFromChroma(chroma);

    return {
      vocalStartSec,
      bpm,
      keyScale,
      totalSec,
    };
  } catch {
    return { vocalStartSec: 0, bpm: 108, keyScale: 'C major', totalSec: 0 };
  } finally {
    try {
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    } catch {
      // ignore
    }
  }
}

async function detectVocalStartSec(audioFilePath, ffmpegPath, maxScanSec = 60) {
  const info = await analyzeReferenceTrack(audioFilePath, ffmpegPath, maxScanSec);
  return info.vocalStartSec || 0;
}

module.exports = {
  analyzeReferenceTrack,
  detectVocalStartSec,
  freqToMidi,
};
