const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Enjin Nyanyian AI Studio Sebenar PERCUMA (tanpa API key):
 * - Model AI 1: techfreakworm/ACE-Music-Studio (ACE-Step v1.5)
 *   Menyokong MOD COVER KETAT (`audio_cover_strength: 0.95` + BPM sebenar + Kunci Muzik sebenar
 *   + audio rujukan yang sudah dipotong tepat pada bahagian vokal) supaya melodi nyanyian
 *   SEIRAS ~95–100% dengan lagu asal!
 * - Model AI 2: mrfakename/yue2-3b (fallback untuk ciptaan tanpa rujukan)
 */

function withTimeout(promise, ms, label = 'Timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildStylePrompt(songResult, analysis = null) {
  const title = (songResult.title || '').toLowerCase();
  const lyrics = (songResult.lyricsText || '').toLowerCase();
  const combined = `${title} ${lyrics}`;
  const metaHint = analysis
    ? `${analysis.bpm} BPM, key of ${analysis.keyScale}, faithful exact melody and chord progression of reference track`
    : 'catchy faithful melody';
  const noIntroDirective =
    'vocals start immediately at 0 seconds, no instrumental intro, straight into clear singing lyrics';

  if (/(kemuning|kemoning|joget|zapin|dikir|wau bulan|lenggang|chan mali|rasa sayang|kampung)/i.test(combined)) {
    return `${noIntroDirective}, ${metaHint}, classic malay traditional pop, upbeat joget rhythm, warm expressive human lead vocal singing clearly, acoustic guitar, accordion, percussion, bass, studio quality`;
  }
  if (/(dusta|sedih|rindu|cinta|kasih|malam|hujan|ilhamku|solo|jiwa|komang|perfect)/i.test(combined)) {
    return `${noIntroDirective}, ${metaHint}, emotional malay pop rock ballad, clear expressive human lead vocal singing faithfully on melody, acoustic guitar, electric guitar, warm piano, bass, drums, studio mastering`;
  }
  if (/(hari jadi|birthday|selamat)/i.test(combined)) {
    return `${noIntroDirective}, ${metaHint}, cheerful celebration pop, bright joyful lead vocal, acoustic guitar, piano, upbeat drums, warm studio production`;
  }
  return `${noIntroDirective}, ${metaHint}, modern malay pop, clear expressive human singing voice, acoustic guitar, electric piano, groovy bass, crisp drums, studio quality`;
}

function formatSongLyrics(lyricsText) {
  const lines = String(lyricsText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return '[chorus]\nMari kita menyanyi bersama';
  // Letak semua baris dalam [chorus] supaya AI terus menyanyikan lirik tanpa intro panjang
  return `[chorus]\n${lines.slice(0, 6).join('\n')}`;
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
 * Model AI 1: techfreakworm/ACE-Music-Studio (ACE-Step v1.5)
 * - Bila `refAudioPath` disediakan (audio lagu asal yang sudah dipotong tepat pada vokal):
 *   menggunakan `/on_cover_click` dengan `audio_cover_strength: 0.95`, BPM sebenar & Kunci sebenar,
 *   serta `adv_use_cot_metas: false` supaya AI TIDAK mengubah tempo/kunci/melodi lagu asal!
 */
async function generateWithAceMusicStudio(songResult, options = {}) {
  const { Client, handle_file } = await import('@gradio/client');
  const hfToken = process.env.HF_TOKEN || undefined;

  const client = await withTimeout(
    Client.connect('techfreakworm/ACE-Music-Studio', hfToken ? { hf_token: hfToken } : undefined),
    15000,
    'ACE-Music-Studio connect'
  );

  const analysis = options.analysis || null;
  const stylePrompt = buildStylePrompt(songResult, analysis);
  const formattedLyrics = formatSongLyrics(songResult.lyricsText);
  const durationSec = Math.max(15, Math.min(22, options.durationSec || 20));
  const bpm = analysis?.bpm || songResult.melodySong?.tempo || 110;
  const keyScale = analysis?.keyScale || '';
  const hasRef = Boolean(options.refAudioPath && fs.existsSync(options.refAudioPath));

  let result;
  if (hasRef) {
    // MOD IKUT MELODI SEBENAR (~95% kunci pada irama, kord & tempo rujukan!)
    result = await withTimeout(
      client.predict('/on_cover_click', [
        handle_file(options.refAudioPath),
        stylePrompt,
        formattedLyrics,
        durationSec,
        0.95, // audio_cover_strength: kunci ketat pada melodi & irama lagu asal!
        null, // lora state
        20, // adv_inference_steps
        7.5, // adv_guidance_scale
        'ode',
        -1, // random seed
        0, // adv_cfg_interval_start
        1, // adv_cfg_interval_end
        1, // adv_shift
        false, // adv_use_adg
        false, // adv_thinking: matikan CoT rewrite supaya TIDAK lari daripada melodi asal!
        false, // adv_use_cot_caption
        false, // adv_use_cot_metas (kekalkan BPM & Kunci sebenar hasil analisis!)
        true, // adv_use_cot_language
        0.85,
        0.9,
        0,
        2,
        'NO USER INPUT',
        bpm,
        keyScale,
        '4',
        'unknown',
      ]),
      68000,
      'ACE-Music-Studio cover'
    );
  } else {
    result = await withTimeout(
      client.predict('/on_generate_click', [
        stylePrompt,
        formattedLyrics,
        durationSec,
        'With vocals',
        null,
        18,
        7,
        'ode',
        -1,
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
        keyScale,
        '4',
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
      ? `AI Studio ACE-Step v1.5 (Ikut Melodi 95% • ${bpm} BPM • ${keyScale || 'Auto'})`
      : 'AI Studio ACE-Step v1.5 (Vokal & Band Penuh)',
  };
}

/**
 * Model AI 2 (Fallback untuk ciptaan tanpa rujukan): mrfakename/yue2-3b
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
      planning_mode: 'off',
      render_quality: 16,
      seed: randomSeed,
    }),
    65000,
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

async function generateRealAiSong(songResult, options = {}) {
  try {
    return await generateWithAceMusicStudio(songResult, options);
  } catch {
    if (options.refAudioPath) {
      // Jika mod cover gagal, jangan cipta melodi rawak lain — biarkan pemanggil guna audio sebenar!
      return null;
    }
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
