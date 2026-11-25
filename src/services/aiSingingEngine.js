const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Enjin Nyanyian AI Studio Sebenar PERCUMA (tanpa API key):
 * - Model AI 1: techfreakworm/ACE-Music-Studio (ACE-Step v1.5 — vokal manusia realistik & band penuh, menyokong cover ikut lagu rujukan!)
 * - Model AI 2: mrfakename/yue2-3b (YuE2-3B — fallback automatik vokal studio & muzik penuh)
 */

function withTimeout(promise, ms, label = 'Timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildStylePrompt(songResult) {
  const title = (songResult.title || '').toLowerCase();
  const lyrics = (songResult.lyricsText || '').toLowerCase();
  const combined = `${title} ${lyrics}`;
  const noIntroDirective = 'vocals start immediately at 0 seconds, no instrumental intro, straight into clear singing lyrics';

  if (/(kemuning|kemoning|joget|zapin|dikir|wau bulan|lenggang|chan mali|rasa sayang|kampung)/i.test(combined)) {
    return `${noIntroDirective}, classic malay traditional pop, upbeat joget rhythm, warm expressive human lead vocal singing clearly, acoustic guitar, accordion, percussion, bass, studio quality`;
  }
  if (/(sedih|rindu|cinta|kasih|malam|hujan|ilhamku|solo|jiwa)/i.test(combined)) {
    return `${noIntroDirective}, emotional malay pop ballad, clear expressive human singing vocal, warm grand piano, acoustic guitar, lush strings, soft drums, studio mastering`;
  }
  if (/(hari jadi|birthday|selamat)/i.test(combined)) {
    return `${noIntroDirective}, cheerful celebration pop, bright joyful lead vocal, acoustic guitar, piano, upbeat drums, warm studio production`;
  }
  return `${noIntroDirective}, modern malay pop, catchy upbeat melody, clear expressive human singing voice, acoustic guitar, electric piano, groovy bass, crisp drums, studio quality`;
}

function formatSongLyrics(lyricsText) {
  const lines = String(lyricsText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return '[chorus]\nMari kita menyanyi bersama';
  if (lines.length <= 2) {
    return `[chorus]\n${lines.join('\n')}\n${lines.join('\n')}`;
  }
  const mid = Math.ceil(lines.length / 2);
  return `[verse]\n${lines.slice(0, mid).join('\n')}\n\n[chorus]\n${lines.slice(mid).join('\n')}`;
}

function extractAudioUrlFromGradioData(data) {
  if (!data) return null;
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
    if (typeof item === 'object') {
      if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
      if (item.value && typeof item.value.url === 'string') return item.value.url;
    }
  }
  return null;
}

async function downloadAudioUrlToFile(url, outPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BotNyanyiWhatsApp/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4096) throw new Error('Audio AI terlalu kecil');
    fs.writeFileSync(outPath, buf);
    return outPath;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Model AI 1: techfreakworm/ACE-Music-Studio (ACE-Step v1.5 — disahkan aktif & percuma!)
 */
async function generateWithAceMusicStudio(songResult, options = {}) {
  const { Client, handle_file } = await import('@gradio/client');
  const hfToken = process.env.HF_TOKEN || undefined;

  const client = await withTimeout(
    Client.connect('techfreakworm/ACE-Music-Studio', hfToken ? { hf_token: hfToken } : undefined),
    15000,
    'ACE-Music-Studio connect'
  );

  const stylePrompt = buildStylePrompt(songResult);
  const formattedLyrics = formatSongLyrics(songResult.lyricsText);
  const durationSec = Math.max(15, Math.min(22, options.durationSec || 20));
  const bpm = songResult.melodySong?.tempo || 118;
  const hasRef = Boolean(options.refAudioPath && fs.existsSync(options.refAudioPath));

  let result;
  if (hasRef) {
    // Mod Cover: ikut irama & gaya lagu rujukan sebenar daripada YouTube/Studio!
    result = await withTimeout(
      client.predict('/on_cover_click', [
        handle_file(options.refAudioPath),
        stylePrompt,
        formattedLyrics,
        durationSec,
        0.78, // audio_cover_strength
        null, // lora state
        18, // adv_inference_steps (pantas & kualiti studio)
        7, // adv_guidance_scale
        'ode',
        -1, // random seed
        0,
        1,
        1,
        false,
        true,
        true,
        true,
        true,
        0.85,
        0.9,
        0,
        2,
        'NO USER INPUT',
        bpm,
        '',
        '',
        'unknown',
      ]),
      68000,
      'ACE-Music-Studio cover'
    );
  } else {
    // Mod Cipta Lagu Baharu (vokal + band penuh kualiti studio)
    result = await withTimeout(
      client.predict('/on_generate_click', [
        stylePrompt,
        formattedLyrics,
        durationSec,
        'With vocals',
        null, // lora state
        18, // adv_inference_steps
        7, // adv_guidance_scale
        'ode',
        -1, // random seed
        0,
        1,
        1,
        false,
        true,
        true,
        true,
        true,
        0.85,
        0.9,
        0,
        2,
        'NO USER INPUT',
        bpm,
        '',
        '',
        'unknown',
      ]),
      68000,
      'ACE-Music-Studio generate'
    );
  }

  const audioUrl = extractAudioUrlFromGradioData(result?.data);
  if (!audioUrl) throw new Error('Tiada URL audio daripada ACE-Music-Studio');

  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const outPath = path.join(config.TMP_DIR, `acestudio-${crypto.randomBytes(5).toString('hex')}.wav`);
  await downloadAudioUrlToFile(audioUrl, outPath);

  return {
    path: outPath,
    modelName: hasRef
      ? 'AI Studio ACE-Step v1.5 (Cover Ikut Irama Sebenar)'
      : 'AI Studio ACE-Step v1.5 (Vokal & Band Penuh)',
  };
}

/**
 * Model AI 2 (Fallback Automatik): mrfakename/yue2-3b (YuE2-3B)
 */
async function generateWithYuE2(songResult) {
  const { Client } = await import('@gradio/client');
  const hfToken = process.env.HF_TOKEN || undefined;

  const client = await withTimeout(
    Client.connect('mrfakename/yue2-3b', hfToken ? { hf_token: hfToken } : undefined),
    15000,
    'YuE2-3B connect'
  );

  const stylePrompt = buildStylePrompt(songResult);
  const formattedLyrics = formatSongLyrics(songResult.lyricsText);
  const randomSeed = Math.floor(Math.random() * 999999);

  const result = await withTimeout(
    client.predict('/generate_song', {
      style: stylePrompt,
      lyrics: formattedLyrics,
      planning_mode: 'melody',
      render_quality: 16,
      seed: randomSeed,
    }),
    70000,
    'YuE2-3B generate'
  );

  const audioUrl = extractAudioUrlFromGradioData(result?.data);
  if (!audioUrl) throw new Error('Tiada URL audio daripada YuE2-3B');

  fs.mkdirSync(config.TMP_DIR, { recursive: true });
  const outPath = path.join(config.TMP_DIR, `yue2-${crypto.randomBytes(5).toString('hex')}.wav`);
  await downloadAudioUrlToFile(audioUrl, outPath);

  return {
    path: outPath,
    modelName: 'AI Studio YuE2-3B (Vokal & Band Penuh)',
  };
}

/**
 * Jana lagu nyanyian AI studio sebenar dengan auto-failover antara ACE-Step v1.5 dan YuE2-3B.
 */
async function generateRealAiSong(songResult, options = {}) {
  try {
    return await generateWithAceMusicStudio(songResult, options);
  } catch {
    try {
      return await generateWithYuE2(songResult);
    } catch {
      return null;
    }
  }
}

module.exports = {
  generateRealAiSong,
  generateWithAceMusicStudio,
  generateWithYuE2,
};
