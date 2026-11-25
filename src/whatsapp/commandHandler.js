const { findSongOrAdapt, SONGS_DB } = require('../services/songFinder');
const { generateSingingAudio } = require('../services/singingSynth');

/**
 * Ekstrak teks daripada objek mesej Baileys (teks biasa, extendedText, atau kapsyen media).
 */
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

/**
 * Ekstrak teks mesej yang di-reply (quotedMessage).
 */
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

/**
 * Kendali arahan WhatsApp untuk satu sesi slot.
 */
async function handleIncomingMessage({ sock, slot, msg, sendTracked }) {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const rawText = extractMessageText(msg.message).trim();
  if (!rawText) return;

  const lower = rawText.toLowerCase();

  // Semak arahan yang disokong sahaja (elak gangguan perbualan biasa)
  const isNyanyi = /^(\/nyanyi|!nyanyi|\/sing|!sing)\b/i.test(lower);
  const isMasa = /^(\/masa|!masa)\b/i.test(lower);
  const isLagu = /^(\/lagu|!lagu)\b/i.test(lower);
  const isHelp = /^(\/bantuan|!bantuan|\/help|!help)\b/i.test(lower);

  if (!isNyanyi && !isMasa && !isLagu && !isHelp) return;

  // 1. /masa — semak baki masa sesi
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

  // 2. /lagu — senarai irama terbina dalam
  if (isLagu) {
    const list = SONGS_DB.map((s, idx) => `${idx + 1}. *${s.title}* (\`${s.id}\`)`).join('\n');
    await sendTracked(
      remoteJid,
      {
        text:
          `🎼 *Senarai Irama Sebenar Terbina Dalam:*\n\n${list}\n\n` +
          `💡 *Cara guna:*\n` +
          `• Taip \`/nyanyi sua sue kumoning\`\n` +
          `• Reply mana-mana mesej dengan \`/nyanyi\`\n` +
          `• Paksa suara bot: \`/nyanyi suara sua sue kumoning\`\n` +
          `• Pilih irama khas: \`/nyanyi irama:rasa-sayang jom makan nasi lemak\``,
      },
      { quoted: msg }
    );
    return;
  }

  // 3. /bantuan — panduan ringkas
  if (isHelp) {
    await sendTracked(
      remoteJid,
      {
        text:
          `🎤 *Panduan Bot Nyanyi WhatsApp*\n\n` +
          `1️⃣ *Reply mesej/lirik* dengan \`/nyanyi\` — bot akan cari lagu sebenar; jika tiada, bot sesuaikan teks jadi lirik & nyanyi ikut irama sebenar!\n` +
          `2️⃣ Taip \`/nyanyi sua sue kumoning\` — cari & nyanyikan terus.\n` +
          `3️⃣ Taip \`/nyanyi suara <teks>\` — paksa suara bot menyanyi ikut melodi.\n` +
          `4️⃣ Taip \`/nyanyi irama:<id> <teks>\` — pilih irama sendiri.\n` +
          `5️⃣ Taip \`/lagu\` — lihat senarai irama.\n` +
          `6️⃣ Taip \`/masa\` — semak baki sesi aktif.`,
      },
      { quoted: msg }
    );
    return;
  }

  // 4. /nyanyi — cari lagu / suai padan lirik & nyanyikan!
  const argText = rawText.replace(/^(\/nyanyi|!nyanyi|\/sing|!sing)\s*/i, '').trim();
  const quotedText = extractQuotedText(msg.message);

  let forceBotVoice = false;
  let preferredMelody = null;
  let query = argText;

  // Parse pilihan "suara" atau "irama:<nama>"
  if (/^suara\b/i.test(query)) {
    forceBotVoice = true;
    query = query.replace(/^suara\s*/i, '').trim();
  }

  const iramaMatch = query.match(/^irama:([^\s]+)\s*(.*)$/i);
  if (iramaMatch) {
    preferredMelody = iramaMatch[1].replace(/[-_]/g, ' ');
    query = (iramaMatch[2] || '').trim();
    forceBotVoice = true;
  }

  // Jika pengguna reply mesej tanpa teks tambahan selepas /nyanyi, gunakan teks yang di-reply
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
    // Tunjuk status "recording audio..." di WhatsApp
    await sock.sendPresenceUpdate('recording', remoteJid).catch(() => {});

    const songResult = await findSongOrAdapt(query, {
      forceBotVoice,
      preferredMelody,
    });

    const audio = await generateSingingAudio(songResult);

    // Bina kapsyen maklumat lagu sebelum menghantar voice note nyanyian
    let infoText = '';
    if (songResult.found) {
      const modeLabel =
        audio.actualMode === 'real_audio_clip'
          ? 'Klip Audio Lagu Sebenar'
          : audio.usedVocal
            ? 'Nyanyian Suara Bot (Ikut Irama Sebenar)'
            : 'Instrumental Irama Sebenar';

      infoText =
        `🎵 *Lagu Dijumpai!*\n` +
        `• *Tajuk:* ${songResult.title}\n` +
        `• *Artis:* ${songResult.artist}\n` +
        `• *Mod:* ${modeLabel}\n` +
        `• *Sumber:* ${songResult.source}\n\n` +
        `📜 *Lirik:*\n_${songResult.lyricsText}_`;
    } else {
      infoText =
        `🎶 *Lagu tidak dijumpai — Lirik disesuaikan mengikut irama sebenar!*\n` +
        `• *Irama Dipilih:* ${songResult.melodySong.title}\n` +
        `• *Mod:* ${audio.usedVocal ? 'Nyanyian Suara Bot Bernada' : 'Melodi Instrumental'}\n\n` +
        `📜 *Lirik Suai Padan:*\n_${songResult.lyricsText}_`;
    }

    await sendTracked(remoteJid, { text: infoText }, { quoted: msg });

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
        text: `⚠️ Maaf, gagal menjana nyanyian buat masa ini (${err.message || 'ralat audio'}). Sila cuba lagi sebentar.`,
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
