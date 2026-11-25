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

  console.log('\n--- UJIAN 1: "sua sue kumoning" (Lirik Sebenar P. Ramlee + YouTube) ---');
  const t1 = Date.now();
  const res1 = await findSongOrAdapt('sua sue kumoning');
  console.log({
    found: res1.found,
    mode: res1.mode,
    title: res1.title,
    artist: res1.artist,
    source: res1.source,
    youtubeSong: res1.youtubeSongVideo?.url || null,
    youtubeKaraoke: res1.youtubeKaraokeVideo?.url || null,
    lyrics: res1.lyricsText,
  });
  if (!res1.found || !res1.lyricsText.toLowerCase().includes('istimewa raja')) {
    throw new Error('Lirik sebenar Sua Sue Kemuning tidak sepadan!');
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

  console.log('\n--- UJIAN 2: Lagu luar pangkalan data ("kau ilhamku") ---');
  const t2b = Date.now();
  const resWeb = await findSongOrAdapt('kau ilhamku');
  console.log({
    found: resWeb.found,
    title: resWeb.title,
    artist: resWeb.artist,
    source: resWeb.source,
    youtubeSong: resWeb.youtubeSongVideo?.url || null,
    lyricsPreview: resWeb.lyricsText.split('\n').slice(0, 2).join(' / '),
  });
  const audioWeb = await generateSingingAudio(resWeb);
  console.log('Audio Web dijana:', {
    bytes: audioWeb.buffer.length,
    header: audioWeb.buffer.slice(0, 4).toString('ascii'),
    actualMode: audioWeb.actualMode,
    modelUsed: audioWeb.modelUsed,
    elapsedMs: Date.now() - t2b,
  });
  if (audioWeb.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Output audio web bukan fail OGG Opus yang sah!');
  }

  console.log('\n--- UJIAN 3: Mesej rawak (suai padan lirik + nyanyian ikut irama sebenar) ---');
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
