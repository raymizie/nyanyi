/**
 * Ujian hujung-ke-hujung:
 * 1. "sua sue kumoning" -> Lagu Sebenar (YouTube / Studio, BUKAN MIDI!)
 * 2. "kau ilhamku" -> Lagu Sebenar (Man Bai, YouTube / Studio)
 * 3. Mesej rawak -> Nyanyian AI Studio Sebenar (ACE-Step / DiffRhythm)
 */
const { findSongOrAdapt } = require('../src/services/songFinder');
const { generateSingingAudio, getFfmpegPath } = require('../src/services/singingSynth');

async function main() {
  console.log('FFmpeg dikesan:', getFfmpegPath());

  console.log('\n--- UJIAN 1: "sua sue kumoning" (REAL SONG) ---');
  const t1 = Date.now();
  const res1 = await findSongOrAdapt('sua sue kumoning');
  console.log({
    found: res1.found,
    title: res1.title,
    artist: res1.artist,
    youtubeSong: res1.youtubeSongVideo?.url || null,
    hasPreview: Boolean(res1.previewUrl),
  });
  const audio1 = await generateSingingAudio(res1);
  console.log('Audio 1:', {
    bytes: audio1.buffer.length,
    header: audio1.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio1.actualMode,
    modelUsed: audio1.modelUsed,
    elapsedMs: Date.now() - t1,
  });
  if (audio1.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Audio 1 bukan OggS!');
  }

  console.log('\n--- UJIAN 2: "kau ilhamku" (REAL SONG LUAR DB) ---');
  const t2 = Date.now();
  const res2 = await findSongOrAdapt('kau ilhamku');
  const audio2 = await generateSingingAudio(res2);
  console.log('Audio 2:', {
    title: res2.title,
    artist: res2.artist,
    bytes: audio2.buffer.length,
    header: audio2.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio2.actualMode,
    modelUsed: audio2.modelUsed,
    elapsedMs: Date.now() - t2,
  });
  if (audio2.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Audio 2 bukan OggS!');
  }

  console.log('\n--- UJIAN 3: Mesej rawak -> AI Studio Singing (ACE-Step / DiffRhythm) ---');
  const t3 = Date.now();
  const res3 = await findSongOrAdapt('Abang jangan lupa beli nasi lemak telur mata dua bungkus');
  const audio3 = await generateSingingAudio(res3);
  console.log('Audio 3:', {
    bytes: audio3.buffer.length,
    header: audio3.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio3.actualMode,
    modelUsed: audio3.modelUsed,
    elapsedMs: Date.now() - t3,
  });
  if (audio3.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Audio 3 bukan OggS!');
  }

  console.log('\nSEMUA UJIAN BERJAYA!');
  process.exit(0);
}

main().catch((err) => {
  console.error('UJIAN GAGAL:', err);
  process.exit(1);
});
