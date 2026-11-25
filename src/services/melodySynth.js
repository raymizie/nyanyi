const fs = require('fs');

const SAMPLE_RATE = 44100;

const NOTE_OFFSETS = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

function noteToMidi(noteStr) {
  if (!noteStr || noteStr === 'R') return null;
  const match = String(noteStr).toUpperCase().match(/^([A-G][#B]?)(-?\d)$/);
  if (!match) return 60; // C4 fallback
  const [, pitch, oct] = match;
  return (parseInt(oct, 10) + 1) * 12 + (NOTE_OFFSETS[pitch] ?? 0);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Tulis Float32Array [-1, 1] kepada fail WAV 16-bit mono PCM.
 */
function writeWavFile(filePath, samples, sampleRate = SAMPLE_RATE) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Soft limiter + normalization
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  const gain = peak > 0.92 ? 0.92 / peak : 1.0;

  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

/**
 * Sintesis satu nota melodi utama (bunyi keyboard/flute hangat dengan vibrato lembut).
 */
function addLeadNote(buf, startSec, durationSec, midi, volume = 0.34) {
  if (midi == null) return;
  const freq = midiToFreq(midi);
  const startIdx = Math.floor(startSec * SAMPLE_RATE);
  const totalSamples = Math.floor(durationSec * SAMPLE_RATE);
  const attack = Math.min(0.025, durationSec * 0.18);
  const release = Math.min(0.09, durationSec * 0.3);

  for (let i = 0; i < totalSamples; i++) {
    const idx = startIdx + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SAMPLE_RATE;

    // ADSR envelope
    let env = 1.0;
    if (t < attack) {
      env = t / attack;
    } else if (t > durationSec - release) {
      env = Math.max(0, (durationSec - t) / release);
    } else {
      env = 1.0 - 0.18 * ((t - attack) / Math.max(0.01, durationSec - attack));
    }

    const vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 5.2 * t);
    const phase = 2 * Math.PI * freq * vibrato * t;

    const wave =
      Math.sin(phase) * 0.68 +
      Math.sin(phase * 2) * 0.22 +
      Math.sin(phase * 3) * 0.07 +
      Math.sin(phase * 4) * 0.03;

    buf[idx] += wave * env * volume;
  }
}

/**
 * Sintesis kord iringan lembut (warm pad) dan bass.
 */
function addChordAndBass(buf, startSec, durationSec, chordNotes = ['C3', 'E3', 'G3'], beatSec = 0.5) {
  const startIdx = Math.floor(startSec * SAMPLE_RATE);
  const totalSamples = Math.floor(durationSec * SAMPLE_RATE);
  const midis = chordNotes.map(noteToMidi).filter((m) => m != null);
  if (!midis.length) return;

  const freqs = midis.map(midiToFreq);
  const attack = 0.08;
  const release = 0.18;

  // Pad
  for (let i = 0; i < totalSamples; i++) {
    const idx = startIdx + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SAMPLE_RATE;
    let env = 1.0;
    if (t < attack) env = t / attack;
    else if (t > durationSec - release) env = Math.max(0, (durationSec - t) / release);

    let sum = 0;
    for (const f of freqs) {
      sum += Math.sin(2 * Math.PI * f * t) * 0.75 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
    }
    buf[idx] += (sum / freqs.length) * env * 0.16;
  }

  // Bass pluck pada setiap 2 beat
  const bassFreq = midiToFreq(midis[0] - 12);
  const numPlucks = Math.max(1, Math.floor(durationSec / (beatSec * 2)));
  for (let p = 0; p < numPlucks; p++) {
    const pStart = Math.floor((startSec + p * beatSec * 2) * SAMPLE_RATE);
    const pLen = Math.floor(Math.min(beatSec * 1.6, 0.75) * SAMPLE_RATE);
    for (let i = 0; i < pLen; i++) {
      const idx = pStart + i;
      if (idx < 0 || idx >= buf.length) continue;
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.012) * Math.exp(-t * 4.5);
      buf[idx] += (Math.sin(2 * Math.PI * bassFreq * t) + 0.25 * Math.sin(4 * Math.PI * bassFreq * t)) * env * 0.24;
    }
  }
}

/**
 * Sintesis rentak perkusi lembut (kick + shaker) mengikut gaya lagu.
 */
function addPercussion(buf, totalSec, beatSec, style = 'joget') {
  const numBeats = Math.floor(totalSec / beatSec);
  const beatsPerBar = style === 'waltz' ? 3 : 4;

  // Deterministic pseudo-random for shaker noise
  let seed = 1337;
  const nextNoise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 1073741823.5) - 1;
  };

  for (let b = 0; b < numBeats; b++) {
    const beatInBar = b % beatsPerBar;
    const t0 = b * beatSec;
    const startIdx = Math.floor(t0 * SAMPLE_RATE);

    // Kick pada beat kuat
    if (beatInBar === 0 || (style === 'joget' && beatInBar === 2) || (style === 'march' && beatInBar === 2)) {
      const len = Math.floor(0.11 * SAMPLE_RATE);
      for (let i = 0; i < len; i++) {
        const idx = startIdx + i;
        if (idx >= buf.length) break;
        const t = i / SAMPLE_RATE;
        const f = 115 * Math.exp(-t * 24) + 46;
        const env = Math.exp(-t * 22);
        buf[idx] += Math.sin(2 * Math.PI * f * t) * env * 0.22;
      }
    }

    // Soft snare/shaker pada off-beat
    if (beatInBar === 1 || beatInBar === 3 || (style === 'waltz' && (beatInBar === 1 || beatInBar === 2))) {
      const len = Math.floor(0.055 * SAMPLE_RATE);
      for (let i = 0; i < len; i++) {
        const idx = startIdx + i;
        if (idx >= buf.length) break;
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 55);
        buf[idx] += nextNoise() * env * 0.075;
      }
    }
  }
}

/**
 * Bina trek iringan melodi WAV + metadata masa & pic setiap frasa untuk suara nyanyian bot.
 */
function synthesizeBackingTrack(melodySong, phrases, outputWavPath) {
  const bpm = melodySong.tempo || 114;
  const beatSec = 60 / bpm;
  const introSec = beatSec * 2; // intro 2 beat supaya sedap didengar
  const phraseGapSec = beatSec * 0.6;
  const outroSec = beatSec * 2;

  // Kira jumlah tempoh lagu & masa setiap frasa
  let cursorSec = introSec;
  const phraseMeta = [];

  for (const phrase of phrases) {
    const notes = phrase.notes && phrase.notes.length ? phrase.notes : [['C4', 1], ['E4', 1], ['G4', 1], ['E4', 1]];
    const phraseStart = cursorSec;
    let totalBeats = 0;
    const noteTimeline = [];

    for (const [noteName, beats] of notes) {
      const dur = beats * beatSec;
      const midi = noteToMidi(noteName);
      noteTimeline.push({
        startSec: cursorSec,
        durationSec: dur,
        midi,
      });
      cursorSec += dur;
      totalBeats += beats;
    }

    phraseMeta.push({
      text: phrase.text,
      startSec: phraseStart,
      durationSec: totalBeats * beatSec,
      chord: phrase.chord || ['C3', 'E3', 'G3'],
      notes: noteTimeline,
    });

    cursorSec += phraseGapSec;
  }

  const totalSec = cursorSec + outroSec;
  const totalSamples = Math.ceil(totalSec * SAMPLE_RATE);
  const mixBuf = new Float32Array(totalSamples);

  // Intro arpeggio ringkas
  const firstChord = phraseMeta[0]?.chord || ['C3', 'E3', 'G3'];
  firstChord.forEach((n, idx) => {
    const m = noteToMidi(n);
    if (m != null) {
      addLeadNote(mixBuf, idx * (beatSec * 0.5), beatSec * 0.9, m + 12, 0.24);
    }
  });

  // Render setiap frasa: kord + bass + melodi utama
  for (const pm of phraseMeta) {
    addChordAndBass(mixBuf, pm.startSec, pm.durationSec + phraseGapSec * 0.5, pm.chord, beatSec);
    for (const n of pm.notes) {
      addLeadNote(mixBuf, n.startSec, n.durationSec * 0.95, n.midi, 0.34);
    }
  }

  // Outro chord
  const lastChord = phraseMeta[phraseMeta.length - 1]?.chord || ['C3', 'E3', 'G3'];
  addChordAndBass(mixBuf, cursorSec, outroSec * 0.9, lastChord, beatSec);

  // Perkusi lembut
  addPercussion(mixBuf, totalSec - outroSec * 0.5, beatSec, melodySong.style || 'joget');

  writeWavFile(outputWavPath, mixBuf, SAMPLE_RATE);

  return {
    wavPath: outputWavPath,
    totalSec,
    bpm,
    beatSec,
    phrases: phraseMeta,
  };
}

module.exports = {
  synthesizeBackingTrack,
  noteToMidi,
  midiToFreq,
};
