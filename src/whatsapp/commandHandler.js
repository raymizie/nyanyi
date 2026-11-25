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
    const list = SONGS_DB.map((s, idx) => `${idx + 1}. *${s.title}* (\`${s.id}\`)`).join('\n');
    await sendTracked(
      remoteJid,
      {
        text:
          `🎼 *Senarai Irama Terbina Dalam (Selain Carian Web & YouTube):*\n\n${list}\n\n` +
          `💡 *Cara guna:*\n` +
          `• \`/nyanyi sua sue kumoning\` — cari lirik sebenar + tiru irama YouTube\n` +
          `• \`/nyanyi asal sua sue kumoning\` — mainkan klip lagu asal dari YouTube\n` +
          `• Reply mana-mana mesej dengan \`/nyanyi\`\n` +
          `• \`/nyanyi cepat <teks>\` — mod pantas (<1s)\n` +
          `• \`/nyanyi irama:rasa-sayang <teks>\` — pilih irama khas`,
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
          `1️⃣ *Reply mesej/lirik* dengan \`/nyanyi\` — bot cari lirik di web & irama di YouTube, lalu nyanyi ikut irama sebenar!\n` +
          `2️⃣ \`/nyanyi sua sue kumoning\` — cari lagu, lirik & tiru irama YouTube.\n` +
          `3️⃣ \`/nyanyi asal <tajuk/lirik>\` — hantar klip audio asal YouTube/lagu sebenar.\n` +
          `4️⃣ \`/nyanyi cepat <teks>\` — mod instrumental pantas (<1 saat).\n` +
          `5️⃣ \`/nyanyi irama:<id> <teks>\` — pilih irama sendiri.\n` +
          `6️⃣ \`/lagu\` — senarai irama | \`/masa\` — baki sesi.`,
      },
      { quoted: msg }
    );
    return;
  }

  const argText = rawText.replace(/^(\/nyanyi|!nyanyi|\/sing|!sing)\s*/i, '').trim();
  const quotedText = extractQuotedText(msg.message);

  let originalClip = false;
  let forceLocalSynth = false;
  let fastMode = false;
  let preferredMelody = null;
  let query = argText;

  if (/^(asal|ori|original|youtube|yt)\b/i.test(query)) {
    originalClip = true;
    query = query.replace(/^(asal|ori|original|youtube|yt)\s*/i, '').trim();
  } else if (/^(cepat|pantas|melodi)\b/i.test(query)) {
    fastMode = true;
    forceLocalSynth = true;
    query = query.replace(/^(cepat|pantas|melodi)\s*/i, '').trim();
  } else if (/^suara\b/i.test(query)) {
    query = query.replace(/^suara\s*/i, '').trim();
  }

  const iramaMatch = query.match(/^irama:([^\s]+)\s*(.*)$/i);
  if (iramaMatch) {
    preferredMelody = iramaMatch[1].replace(/[-_]/g, ' ');
    query = (iramaMatch[2] || '').trim();
    forceLocalSynth = true;
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
      originalClip,
      preferredMelody,
    });

    const ytLink =
      songResult.youtubeKaraokeVideo?.url || songResult.youtubeSongVideo?.url || null;

    let infoText = '';
    if (songResult.found) {
      infoText =
        `🎵 *Lagu Dijumpai!*\n` +
        `• *Tajuk:* ${songResult.title}\n` +
        `• *Artis:* ${songResult.artist}\n` +
        `• *Sumber:* ${songResult.source}\n` +
        (ytLink ? `• *Rujukan YouTube:* ${ytLink}\n` : '') +
        `\n📜 *Lirik Sebenar:*\n_${songResult.lyricsText}_\n\n` +
        `🎙️ _Meniru irama & menyiapkan nyanyian..._`;
    } else {
      infoText =
        `🎶 *Lagu tidak dijumpai — Lirik disesuaikan mengikut irama sebenar!*\n` +
        `• *Irama Dipilih:* ${songResult.melodySong.title}\n\n` +
        `📜 *Lirik Suai Padan:*\n_${songResult.lyricsText}_\n\n` +
        `🎙️ _Menyiapkan nyanyian..._`;
    }

    await sendTracked(remoteJid, { text: infoText }, { quoted: msg });

    const audio = await generateSingingAudio(songResult, {
      fastMode,
      originalClip,
      forceLocalSynth,
    });

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
        text: `⚠️ Maaf, gagal menjana nyanyian buat masa ini (${err.message || 'ralat audio'}). Sila cuba \`/nyanyi cepat ${query}\`.`,
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
