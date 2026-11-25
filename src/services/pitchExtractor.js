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

/**
 * Kesan saat TEPAT nyanyian vokal manusia bermula dalam fail audio supaya intro panjang
 * (muzik/dialog filem/senyap) dilangkau secara automatik dan terus masuk bahagian nyanyian!
 *
 * Menggunakan penapis jalur vokal nyanyian (320Hz - 2800Hz) + pengesanan tenaga & keharmonian vokal berterusan.
 */
async function detectVocalStartSec(audioFilePath, ffmpegPath, maxScanSec = 65) {
  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const pcmPath = path.join(config.TMP_DIR, `vad-${crypto.randomBytes(5).toString('hex')}.raw`);
  const sampleRate = 16000;

  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-loglevel', 'error',
        '-i', audioFilePath,
        '-t', String(maxScanSec),
        '-af', 'highpass=f=320,lowpass=f=2800',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-f', 's16le',
        pcmPath,
      ],
      { timeout: 9000 }
    );

    const rawBuf = fs.readFileSync(pcmPath);
    const totalSamples = Math.floor(rawBuf.length / 2);
    const totalSec = totalSamples / sampleRate;
    if (totalSec < 6) return 0;

    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = rawBuf.readInt16LE(i * 2) / 32768;
    }

    // Analisis setiap tetingkap 0.5 saat
    const stepSec = 0.5;
    const stepSamples = Math.floor(sampleRate * stepSec);
    const frameSize = 640; // 40ms
    const windows = [];

    for (let pos = 0; pos + stepSamples < totalSamples - 200; pos += stepSamples) {
      // Ambil 3 sampel bingkai di dalam tetingkap 0.5s
      let voicedHits = 0;
      let avgRms = 0;
      for (let k = 0; k < 3; k++) {
        const info = detectFramePitchInfo(samples, pos + k * 2400, frameSize, sampleRate);
        if (info) {
          avgRms += info.rms;
          if (info.hz && info.corr >= 0.58) voicedHits++;
        }
      }
      avgRms /= 3;
      windows.push({
        sec: pos / sampleRate,
        rms: avgRms,
        voicedHits,
      });
    }

    // Kira ambang tenaga vokal adaptif daripada 75th percentile supaya tidak tertipu dengan bunyi intro perlahan
    const sortedRms = windows.map((w) => w.rms).sort((a, b) => a - b);
    const p75 = sortedRms[Math.floor(sortedRms.length * 0.75)] || 0.05;
    const vocalRmsThreshold = Math.max(0.032, p75 * 0.55);

    // Cari tetingkap pertama di mana vokal jelas kedengaran secara berterusan (>= 3 daripada 4 tetingkap = 1.5–2 saat)
    // Pastikan baki audio selepas startSec masih sekurang-kurangnya 14 saat!
    const maxAllowedStart = Math.max(0, totalSec - 15);

    for (let i = 0; i < windows.length - 4; i++) {
      if (windows[i].sec > maxAllowedStart) break;
      let strongCount = 0;
      for (let j = 0; j < 4; j++) {
        const w = windows[i + j];
        if (w.rms >= vocalRmsThreshold && w.voicedHits >= 2) {
          strongCount++;
        }
      }
      if (strongCount >= 3) {
        // Undur sedikit (0.4s) supaya suku kata pertama tidak terpotong
        return Math.max(0, Number((windows[i].sec - 0.4).toFixed(2)));
      }
    }

    return 0;
  } catch {
    return 0;
  } finally {
    try {
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    } catch {
      // ignore
    }
  }
}

module.exports = {
  detectVocalStartSec,
  freqToMidi,
};
