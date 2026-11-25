/**
 * Ujian sejagat untuk sebarang lagu / petikan lirik:
 * 1. Petikan lirik rock Melayu ("bila cinta didusta") -> cari tepat + langkau intro
 * 2. Lagu pop Nusantara ("komang raim laode") -> rujuk Spotify/LRCLIB/Smule/YouTube + langkau intro
 * 3. Petikan lirik Inggeris ("baby I'm dancing in the dark") -> lompat terus ke baris lirik!
 */
const { findSongOrAdapt } = require('../src/services/songFinder');
const { generateSingingAudio, getFfmpegPath } = require('../src/services/singingSynth');

async function testQuery(label, query) {
  console.log(`\n--- ${label}: "${query}" ---`);
  const t0 = Date.now();
  const res = await findSongOrAdapt(query);
  console.log({
    found: res.found,
    title: res.title,
    artist: res.artist,
    source: res.source,
    vocalStartSec: res.vocalStartSec,
    spotifyUrl: res.spotifyUrl,
    smuleUrl: res.smuleUrl,
    youtube: res.youtubeSongVideo?.title || null,
    lyricsPreview: res.lyricsText.split('\n').slice(0, 2).join(' / '),
  });

  const audio = await generateSingingAudio(res);
  console.log('Audio:', {
    bytes: audio.buffer.length,
    header: audio.buffer.slice(0, 4).toString('ascii'),
    actualMode: audio.actualMode,
    skippedIntroSec: audio.skippedIntroSec ?? null,
    modelUsed: audio.modelUsed,
    elapsedMs: Date.now() - t0,
  });

  if (audio.buffer.slice(0, 4).toString('ascii') !== 'OggS') {
    throw new Error(`Audio untuk "${query}" bukan OggS!`);
  }
}

async function main() {
  console.log('FFmpeg dikesan:', getFfmpegPath());
  await testQuery('UJIAN 1 (Lirik Rock Melayu)', 'bila cinta didusta');
  await testQuery('UJIAN 2 (Pop Nusantara)', 'komang raim laode');
  await testQuery('UJIAN 3 (Petikan Lirik Inggeris)', "baby i'm dancing in the dark");
  console.log('\nSEMUA UJIAN SEJAGAT BERJAYA!');
  process.exit(0);
}

main().catch((err) => {
  console.error('UJIAN GAGAL:', err);
  process.exit(1);
});
