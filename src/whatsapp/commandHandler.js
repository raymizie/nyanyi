const { findSongOrAdapt, adaptLyricsToMelody, SONGS_DB } = require('../services/songFinder');
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
    const list = SONGS_DB.slice(0, 8).map((s, idx) => `${idx + 1}. *${s.title}*`).join('\n');
    await sendTracked(
      remoteJid,
      {
        text:
          `🎼 *Bot mencari SEBARANG lagu di Spotify, Smule, LRCLIB, Genius & YouTube!*\n\n` +
          `💡 *Cara guna:*\n` +
          `• \`/nyanyi bila cinta di dusta\` — cari tajuk & lirik, analisis BPM & kunci lagu asal, lalu **cipta nyanyian mengikut melodi sebenar (95% kunci irama)**!\n` +
          `• \`/nyanyi asal bila cinta di dusta\` — mainkan klip nyanyian lagu asal terus (tanpa intro)\n` +
          `• \`/nyanyi ikut:bila-cinta-didusta <lirik anda sendiri>\` — nyanyikan lirik anda sendiri mengikut melodi lagu pilihan!\n` +
          `• Reply mana-mana mesej dengan \`/nyanyi\`\n\n` +
          `Contoh klasik:\n${list}`,
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
          `1️⃣ *Reply mesej/lirik* dengan \`/nyanyi\` — bot cari lagu, analisis irama sebenar (BPM & Kunci), lalu cipta nyanyian mengikut melodi asal!\n` +
          `2️⃣ \`/nyanyi <petikan lirik>\` — cari & nyanyikan ikut melodi lagu sebenar.\n` +
          `3️⃣ \`/nyanyi asal <tajuk/lirik>\` — terus hantar klip lagu asal (langkau intro).\n` +
          `4️⃣ \`/nyanyi ikut:<tajuk-lagu> <lirik sendiri>\` — nyanyikan teks anda ikut melodi lagu itu!\n` +
          `5️⃣ \`/lagu\` — panduan | \`/masa\` — baki sesi.`,
      },
      { quoted: msg }
    );
    return;
  }

  const argText = rawText.replace(/^(\/nyanyi|!nyanyi|\/sing|!sing)\s*/i, '').trim();
  const quotedText = extractQuotedText(msg.message);

  let originalOnly = false;
  let referenceSongQuery = null;
  let query = argText;

  if (/^(asal|ori|original|youtube|yt)\b/i.test(query)) {
    originalOnly = true;
    query = query.replace(/^(asal|ori|original|youtube|yt)\s*/i, '').trim();
  } else if (/^(ai|cipta|cover)\b/i.test(query)) {
    query = query.replace(/^(ai|cipta|cover)\s*/i, '').trim();
  }

  // Mod khas: `/nyanyi ikut:<nama-lagu> <lirik anda sendiri>`
  const ikutMatch = query.match(/^ikut:([^\s]+)\s*(.*)$/i);
  if (ikutMatch) {
    referenceSongQuery = ikutMatch[1].replace(/[-_]/g, ' ').trim();
    query = (ikutMatch[2] || '').trim();
  }

  if (!query && quotedText) {
    query = quotedText;
  }

  if (!query && !referenceSongQuery) {
    await sendTracked(
      remoteJid,
      {
        text:
          `🎵 Sila *Reply* mana-mana mesej/lirik dengan \`/nyanyi\` atau taip terus contohnya:\n` +
          `\`/nyanyi bila cinta di dusta\``,
      },
      { quoted: msg }
    );
    return;
  }

  try {
    await sock.sendPresenceUpdate('recording', remoteJid).catch(() => {});

    let songResult;
    if (referenceSongQuery) {
      // Cari lagu rujukan untuk melodi, tetapi ganti liriknya dengan teks pengguna!
      songResult = await findSongOrAdapt(referenceSongQuery);
      if (query) {
        const adapted = adaptLyricsToMelody(query, songResult.melodySong);
        songResult.phrases = adapted;
        songResult.lyricsText = adapted.map((p) => p.text).join('\n');
      }
    } else {
      songResult = await findSongOrAdapt(query);
    }

    const ytLink = songResult.youtubeSongVideo?.url || null;
    const spLink = songResult.spotifyUrl || null;
    const smLink = songResult.smuleUrl || null;

    let infoText = '';
    if (songResult.found) {
      infoText =
        `🎵 *Lagu Dijumpai!*\n` +
        `• *Tajuk:* ${songResult.title}\n` +
        `• *Artis:* ${songResult.artist}\n` +
        `• *Sumber:* ${songResult.source}\n` +
        (spLink ? `• *Spotify:* ${spLink}\n` : '') +
        (smLink ? `• *Smule:* ${smLink}\n` : '') +
        (ytLink ? `• *YouTube:* ${ytLink}\n` : '') +
        `\n📜 *Lirik:*\n_${songResult.lyricsText}_\n\n` +
        (originalOnly
          ? `🎧 _Melangkau intro & memuat turun lagu asal..._`
          : `🎼 _Menganalisis melodi, BPM & kunci lagu sebenar untuk mencipta nyanyian yang tepat..._`);
    } else {
      infoText =
        `✨ *Lagu tidak dijumpai — Menyesuaikan lirik & mencipta nyanyian AI Studio...*\n\n` +
        `📜 *Lirik:*\n_${songResult.lyricsText}_\n\n` +
        `🎙️ _Menjana nyanyian terus masuk lirik..._`;
    }

    await sendTracked(remoteJid, { text: infoText }, { quoted: msg });

    const audio = await generateSingingAudio(songResult, {
      originalOnly,
      createMelodyMatch: !originalOnly,
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
        text: `⚠️ Maaf, gagal menyediakan nyanyian buat masa ini (${err.message || 'ralat audio'}). Sila cuba lagi sebentar.`,
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
