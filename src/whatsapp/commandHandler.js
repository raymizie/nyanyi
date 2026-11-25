const { findSongOrAdapt, SONGS_DB } = require('../services/songFinder');
const { generateSingingAudio } = require('../services/singingSynth');

function extractMessageText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.ephemeralMessage?.message) {
    return extractMessageText(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage?.message) {
    return extractMessageText(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2?.message) {
    return extractMessageText(message.viewOnceMessageV2.message);
  }
  return '';
}

function extractQuotedText(message) {
  if (!message) return '';
  const inner =
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message;

  const ctx =
    inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo ||
    null;

  if (!ctx || !ctx.quotedMessage) return '';
  return extractMessageText(ctx.quotedMessage).trim();
}

function formatRemainingTime(ms) {
  const safe = Math.max(0, ms);
  const mins = Math.floor(safe / 60000);
  const secs = Math.floor((safe % 60000) / 1000);
  return `${mins} minit ${secs} saat`;
}

async function handleIncomingMessage({ sock, slot, msg, sendTracked }) {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const rawText = extractMessageText(msg.message).trim();
  if (!rawText) return;

  const lower = rawText.toLowerCase();

  const isNyanyi = /^(\/nyanyi|!nyanyi|\/sing|!sing)\b/i.test(lower);
  const isMasa = /^(\/masa|!masa)\b/i.test(lower);
  const isLagu = /^(\/lagu|!lagu)\b/i.test(lower);
  const isHelp = /^(\/bantuan|!bantuan|\/help|!help)\b/i.test(lower);

  if (!isNyanyi && !isMasa && !isLagu && !isHelp) return;

  if (isMasa) {
    const remainingMs = Math.max(0, (slot.expiresAt || Date.now()) - Date.now());
    await sendTracked(
      remoteJid,
      {
        text:
          `⏱️ *Status Sesi Bot Nyanyi*\n` +
          `• Slot: *#${slot.id}*\n` +
          `• Baki masa: *${formatRemainingTime(remainingMs)}*\n` +
          `• Lagu dinyanyikan: *${slot.songsSung}*\n\n` +
          `_Sesi akan auto-logout selepas tamat tempoh._`,
      },
      { quoted: msg }
    );
    return;
  }

  if (isLagu) {
    const list = SONGS_DB.map((s, idx) => `${idx + 1}. *${s.title}*`).join('\n');
    await sendTracked(
      remoteJid,
      {
        text:
          `🎼 *Bot menyokong SEMUA lagu di YouTube, Deezer, iTunes, LRCLIB & Genius!*\n\n` +
          `Koleksi klasik terkenal:\n${list}\n\n` +
          `💡 *Cara guna:*\n` +
          `• \`/nyanyi sua sue kumoning\` — cari lagu & mainkan *audio lagu sebenar* berkualiti studio\n` +
          `• Reply mana-mana mesej dengan \`/nyanyi\` — jika lagu wujud, mainkan lagu sebenar; jika tiada, **AI Studio (ACE-Step / DiffRhythm)** akan mencipta & menyanyikan lagu baharu untuk teks itu!\n` +
          `• \`/nyanyi ai <teks/lirik>\` — paksa AI Studio menyanyikan lagu baharu dengan suara & band penuh`,
      },
      { quoted: msg }
    );
    return;
  }

  if (isHelp) {
    await sendTracked(
      remoteJid,
      {
        text:
          `🎤 *Panduan Bot Nyanyi WhatsApp*\n\n` +
          `1️⃣ *Reply mesej/lirik* dengan \`/nyanyi\` — jika lagu sebenar wujud, bot hantar *lagu sebenar* (YouTube/Studio). Jika tiada, *AI Studio (ACE-Step / DiffRhythm)* cipta & nyanyikan lagu sebenar daripada mesej itu!\n` +
          `2️⃣ \`/nyanyi sua sue kumoning\` — cari lagu & hantar audio sebenar.\n` +
          `3️⃣ \`/nyanyi ai <lirik/teks>\` — cipta nyanyian AI penuh (suara & instrumen studio).\n` +
          `4️⃣ \`/lagu\` — info lagu | \`/masa\` — baki sesi aktif.`,
      },
      { quoted: msg }
    );
    return;
  }

  const argText = rawText.replace(/^(\/nyanyi|!nyanyi|\/sing|!sing)\s*/i, '').trim();
  const quotedText = extractQuotedText(msg.message);

  let forceAiSing = false;
  let query = argText;

  if (/^(ai|cipta|cover|baru|baharu)\b/i.test(query)) {
    forceAiSing = true;
    query = query.replace(/^(ai|cipta|cover|baru|baharu)\s*/i, '').trim();
  } else if (/^(asal|ori|original|youtube|yt)\b/i.test(query)) {
    query = query.replace(/^(asal|ori|original|youtube|yt)\s*/i, '').trim();
  }

  if (!query && quotedText) {
    query = quotedText;
  }

  if (!query) {
    await sendTracked(
      remoteJid,
      {
        text:
          `🎵 Sila *Reply* mana-mana mesej/lirik dengan \`/nyanyi\` atau taip terus contohnya:\n` +
          `\`/nyanyi sua sue kumoning\``,
      },
      { quoted: msg }
    );
    return;
  }

  try {
    await sock.sendPresenceUpdate('recording', remoteJid).catch(() => {});

    const songResult = await findSongOrAdapt(query, {
      originalClip: !forceAiSing,
    });

    const ytLink = songResult.youtubeSongVideo?.url || null;

    let infoText = '';
    if (songResult.found && !forceAiSing) {
      infoText =
        `🎵 *Lagu Sebenar Dijumpai!*\n` +
        `• *Tajuk:* ${songResult.title}\n` +
        `• *Artis:* ${songResult.artist}\n` +
        `• *Sumber:* ${songResult.source}\n` +
        (ytLink ? `• *YouTube:* ${ytLink}\n` : '') +
        `\n📜 *Lirik:*\n_${songResult.lyricsText}_\n\n` +
        `🎧 _Memuat turun audio lagu sebenar..._`;
    } else {
      infoText =
        `✨ *Mencipta Lagu & Nyanyian AI Studio Sebenar...*\n` +
        `• *Enjin AI:* ACE-Step / DiffRhythm (Vokal & Band Penuh)\n` +
        (songResult.found ? `• *Rujukan Lagu:* ${songResult.title}\n` : '') +
        `\n📜 *Lirik:*\n_${songResult.lyricsText}_\n\n` +
        `🎙️ _Menjana nyanyian studio (±15–30 saat)..._`;
    }

    await sendTracked(remoteJid, { text: infoText }, { quoted: msg });

    const audio = await generateSingingAudio(songResult, { forceAiSing });

    await sendTracked(
      remoteJid,
      {
        audio: audio.buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      },
      { quoted: msg }
    );

    slot.songsSung = (slot.songsSung || 0) + 1;
  } catch (err) {
    await sendTracked(
      remoteJid,
      {
        text: `⚠️ Maaf, gagal menyediakan lagu buat masa ini (${err.message || 'ralat audio'}). Sila cuba lagi sebentar.`,
      },
      { quoted: msg }
    );
  } finally {
    await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
  }
}

module.exports = {
  handleIncomingMessage,
};
