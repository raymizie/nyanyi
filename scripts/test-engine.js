/**
 * Skrip ujian pantas untuk mengesahkan:
 * 1. Pencarian kabur (fuzzy) "sua sue kumoning" -> "Sua Sue Kemoning"
 * 2. Penyesuaian lirik untuk mesej rawak yang tiada lagu sebenar
 * 3. Penjanaan audio nyanyian OGG Opus (WhatsApp Voice Note)
 */
const { findSongOrAdapt } = require('../src/services/songFinder');
const { generateSingingAudio, getFfmpegPath } = require('../src/services/singingSynth');

async function main() {
  console.log('FFmpeg dikesan:', getFfmpegPath());

  console.log('\n--- UJIAN 1: "sua sue kumoning" ---');
  const t1 = Date.now();
  const res1 = await findSongOrAdapt('sua sue kumoning');
  console.log({
    found: res1.found,
    mode: res1.mode,
    title: res1.title,
    artist: res1.artist,
    source: res1.source,
    confidence: res1.confidence,
    lyricsPreview: res1.lyricsText.split('\n')[0],
  });
  if (!res1.found || !res1.title.toLowerCase().includes('sua sue')) {
    throw new Error('Gagal mengenal pasti lagu Sua Sue Kemoning!');
  }

  const audio1 = await generateSingingAudio(res1);
  console.log('Audio 1 dijana:', {
    bytes: audio1.buffer.length,
    header: audio1.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio1.actualMode,
    usedVocal: audio1.usedVocal,
    modelUsed: audio1.modelUsed,
    elapsedMs: Date.now() - t1,
  });
  if (audio1.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Output audio 1 bukan fail OGG Opus yang sah!');
  }

  console.log('\n--- UJIAN 2: Mesej rawak (suai padan lirik + nyanyian ikut irama sebenar) ---');
  const t2 = Date.now();
  const res2 = await findSongOrAdapt('Abang jangan lupa beli nasi lemak telur mata dua bungkus');
  console.log({
    found: res2.found,
    mode: res2.mode,
    title: res2.title,
    melody: res2.melodySong.title,
    lyrics: res2.lyricsText,
  });

  const audio2 = await generateSingingAudio(res2);
  console.log('Audio 2 dijana:', {
    bytes: audio2.buffer.length,
    header: audio2.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio2.actualMode,
    usedVocal: audio2.usedVocal,
    modelUsed: audio2.modelUsed,
    elapsedMs: Date.now() - t2,
  });
  if (audio2.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Output audio 2 bukan fail OGG Opus yang sah!');
  }

  console.log('\n--- UJIAN 3: Mod Pantas (/nyanyi cepat) ---');
  const t3 = Date.now();
  const audio3 = await generateSingingAudio(res1, { fastMode: true });
  console.log('Audio 3 dijana:', {
    bytes: audio3.buffer.length,
    header: audio3.buffer.slice(0, 4).toString('ascii'),
    modelUsed: audio3.modelUsed,
    elapsedMs: Date.now() - t3,
  });
  if (audio3.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Output audio 3 bukan fail OGG Opus yang sah!');
  }

  console.log('\nSEMUA UJIAN BERJAYA!');
}

main().catch((err) => {
  console.error('UJIAN GAGAL:', err);
  process.exit(1);
});
