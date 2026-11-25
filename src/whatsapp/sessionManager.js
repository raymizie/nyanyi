const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

const config = require('../config');
const { handleIncomingMessage } = require('./commandHandler');

const silentLogger = pino({ level: 'silent' });

/**
 * Cache memori ringan dengan TTL — serasi dengan antara muka CacheStore Baileys
 * (`msgRetryCounterCache`) serta penyimpanan mesej untuk `getMessage` bagi mengelakkan
 * ralat WhatsApp "Waiting for this message. This may take a while."
 */
class SimpleTtlCache {
  constructor(maxItems = 500, ttlMs = 15 * 60 * 1000) {
    this.maxItems = maxItems;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.map.size >= this.maxItems) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  del(key) {
    this.map.delete(key);
  }

  flushAll() {
    this.map.clear();
  }
}

function maskPhone(jidOrNumber) {
  const digits = String(jidOrNumber || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) return 'Peranti WhatsApp';
  if (digits.length <= 6) return `+${digits}`;
  return `+${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.maxSlots = config.MAX_SLOTS;
    this.sessionDurationMs = config.SESSION_DURATION_MS;
    this.baileysVersion = null;
    this.slots = [];
    this.sentMessageIds = new Set();

    for (let i = 1; i <= this.maxSlots; i++) {
      this.slots.push(this._createEmptySlot(i));
    }
  }

  _createEmptySlot(id) {
    return {
      id,
      status: 'empty', // 'empty' | 'connecting' | 'qr' | 'connected'
      sock: null,
      qrRaw: null,
      qrDataUrl: null,
      phone: null,
      pushName: null,
      connectedAt: null,
      expiresAt: null,
      expiryTimer: null,
      retryTimer: null,
      songsSung: 0,
      generation: 0,
      messageCache: new SimpleTtlCache(400, 20 * 60 * 1000),
      retryCache: new SimpleTtlCache(500, 10 * 60 * 1000),
    };
  }

  _slotAuthDir(slotId) {
    return path.join(config.SESSIONS_DIR, `slot-${slotId}`);
  }

  _cleanAuthDir(slotId) {
    try {
      fs.rmSync(this._slotAuthDir(slotId), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  async init() {
    try {
      fs.rmSync(config.SESSIONS_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
    fs.mkdirSync(config.SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(config.TMP_DIR, { recursive: true });

    try {
      const { version } = await fetchLatestBaileysVersion();
      this.baileysVersion = version;
    } catch {
      this.baileysVersion = [2, 3000, 1020608496];
    }

    await this.ensureQrSlot();
  }

  emitUpdate() {
    this.emit('update', this.getPublicState());
  }

  getPublicState() {
    const now = Date.now();
    const activeSlots = this.slots
      .filter((s) => s.status === 'connected')
      .map((s) => ({
        id: s.id,
        phone: s.phone,
        pushName: s.pushName || 'Pengguna WhatsApp',
        connectedAt: s.connectedAt,
        expiresAt: s.expiresAt,
        remainingMs: Math.max(0, (s.expiresAt || now) - now),
        songsSung: s.songsSung || 0,
      }));

    const pendingSlot =
      this.slots.find((s) => s.status === 'qr' || s.status === 'connecting') || null;

    const activeCount = activeSlots.length;
    const freeCount = Math.max(0, this.maxSlots - activeCount);

    return {
      botName: config.BOT_NAME,
      maxSlots: this.maxSlots,
      sessionDurationMinutes: config.SESSION_DURATION_MINUTES,
      activeCount,
      freeCount,
      pendingSlot: pendingSlot
        ? {
            id: pendingSlot.id,
            status: pendingSlot.status,
            qrDataUrl: pendingSlot.qrDataUrl,
          }
        : null,
      activeSlots,
      serverTime: now,
    };
  }

  async ensureQrSlot() {
    const existingPending = this.slots.find(
      (s) => s.status === 'qr' || s.status === 'connecting'
    );
    if (existingPending) return existingPending;

    const emptySlot = this.slots.find((s) => s.status === 'empty');
    if (!emptySlot) {
      this.emitUpdate();
      return null;
    }

    await this._startSlot(emptySlot.id, { cleanAuth: true });
    return emptySlot;
  }

  async _startSlot(slotId, { cleanAuth = false } = {}) {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) return;

    this._clearTimers(slot);
    slot.generation += 1;
    const myGen = slot.generation;

    if (slot.sock) {
      try {
        slot.sock.ev.removeAllListeners();
        slot.sock.end(undefined);
      } catch {
        // ignore
      }
      slot.sock = null;
    }

    if (cleanAuth) {
      this._cleanAuthDir(slotId);
      slot.messageCache.flushAll();
      slot.retryCache.flushAll();
    }

    const authDir = this._slotAuthDir(slotId);
    fs.mkdirSync(authDir, { recursive: true });

    slot.status = 'connecting';
    slot.qrRaw = null;
    slot.qrDataUrl = null;
    this.emitUpdate();

    let state;
    let saveCreds;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(authDir));
    } catch {
      slot.status = 'empty';
      this.emitUpdate();
      return;
    }

    const sock = makeWASocket({
      version: this.baileysVersion || [2, 3000, 1020608496],
      auth: state,
      logger: silentLogger,
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 20000,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      msgRetryCounterCache: slot.retryCache,
      // Kritikal: membolehkan Baileys menyulit semula mesej serta-merta jika penerima
      // menunjukkan "Waiting for this message. This may take a while."
      getMessage: async (key) => {
        if (!key?.id) return undefined;
        const cached = slot.messageCache.get(key.id);
        return cached || undefined;
      },
    });

    slot.sock = sock;

    sock.ev.on('creds.update', async () => {
      if (slot.generation !== myGen) return;
      try {
        await saveCreds();
      } catch {
        // ignore
      }
    });

    sock.ev.on('connection.update', async (update) => {
      if (slot.generation !== myGen) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          slot.status = 'qr';
          slot.qrRaw = qr;
          slot.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          this.emitUpdate();
        } catch {
          // ignore QR render error
        }
      }

      if (connection === 'open') {
        slot.status = 'connected';
        slot.qrRaw = null;
        slot.qrDataUrl = null;
        slot.connectedAt = Date.now();
        slot.expiresAt = slot.connectedAt + this.sessionDurationMs;
        slot.songsSung = 0;
        slot.phone = maskPhone(sock.user?.id);
        slot.pushName = sock.user?.name || 'Pengguna WhatsApp';

        this._scheduleExpiry(slot, myGen);
        this.emitUpdate();

        // Jana QR baharu untuk pengguna seterusnya
        this.ensureQrSlot().catch(() => {});
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const wasConnected = slot.status === 'connected';

        if (statusCode === DisconnectReason.restartRequired) {
          slot.retryTimer = setTimeout(() => {
            if (slot.generation === myGen) {
              this._startSlot(slot.id, { cleanAuth: false }).catch(() => {});
            }
          }, 1000);
          return;
        }

        if (!wasConnected && statusCode !== DisconnectReason.loggedOut) {
          slot.retryTimer = setTimeout(() => {
            if (slot.generation === myGen) {
              this._startSlot(slot.id, { cleanAuth: true }).catch(() => {});
            }
          }, 2500);
          return;
        }

        // Sambung semula secara senyap jika terputus sementara (bukan loggedOut)
        if (wasConnected && statusCode !== DisconnectReason.loggedOut && Date.now() < (slot.expiresAt || 0)) {
          slot.retryTimer = setTimeout(() => {
            if (slot.generation === myGen) {
              this._startSlot(slot.id, { cleanAuth: false }).catch(() => {});
            }
          }, 2000);
          return;
        }

        this._resetSlotToEmpty(slot);
        this.ensureQrSlot().catch(() => {});
      }
    });

    const sendTracked = async (jid, content, options = {}) => {
      const sent = await sock.sendMessage(jid, content, options);
      const id = sent?.key?.id;
      if (id) {
        this.sentMessageIds.add(id);
        setTimeout(() => this.sentMessageIds.delete(id), 120000);
        // Simpan mesej dalam cache supaya retry decryption WhatsApp selesai serta-merta
        if (sent.message) {
          slot.messageCache.set(id, sent.message);
        }
      }
      return sent;
    };

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (slot.generation !== myGen) return;
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg?.message) continue;
        if (msg.key?.id) {
          slot.messageCache.set(msg.key.id, msg.message);
          if (this.sentMessageIds.has(msg.key.id)) continue;
        }

        handleIncomingMessage({ sock, slot, msg, sendTracked })
          .then(() => this.emitUpdate())
          .catch(() => {});
      }
    });
  }

  _scheduleExpiry(slot, gen) {
    this._clearTimers(slot);
    const delay = Math.max(1000, (slot.expiresAt || Date.now()) - Date.now());
    slot.expiryTimer = setTimeout(async () => {
      if (slot.generation !== gen) return;
      await this.disconnectSlot(slot.id, 'Tempoh sesi 60 minit telah tamat.');
    }, delay);
  }

  _clearTimers(slot) {
    if (slot.expiryTimer) {
      clearTimeout(slot.expiryTimer);
      slot.expiryTimer = null;
    }
    if (slot.retryTimer) {
      clearTimeout(slot.retryTimer);
      slot.retryTimer = null;
    }
  }

  _resetSlotToEmpty(slot) {
    this._clearTimers(slot);
    slot.generation += 1;
    if (slot.sock) {
      try {
        slot.sock.ev.removeAllListeners();
        slot.sock.end(undefined);
      } catch {
        // ignore
      }
    }
    this._cleanAuthDir(slot.id);
    Object.assign(slot, this._createEmptySlot(slot.id));
    this.emitUpdate();
  }

  async regenerateQr() {
    const pending = this.slots.find((s) => s.status === 'qr' || s.status === 'connecting');
    if (pending) {
      await this._startSlot(pending.id, { cleanAuth: true });
      return pending.id;
    }

    const slot = await this.ensureQrSlot();
    return slot ? slot.id : null;
  }

  async disconnectSlot(slotId, reason = '') {
    const slot = this.slots.find((s) => s.id === Number(slotId));
    if (!slot || slot.status === 'empty') return false;

    const sock = slot.sock;
    if (sock && slot.status === 'connected') {
      try {
        if (reason && sock.user?.id) {
          const selfJid = `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`;
          await sock
            .sendMessage(selfJid, {
              text: `⏱️ *Bot Nyanyi WhatsApp*\n${reason}\nImbas semula kod QR di halaman web untuk menyambung semula.`,
            })
            .catch(() => {});
        }
        await sock.logout().catch(() => {});
      } catch {
        // ignore
      }
    }

    this._resetSlotToEmpty(slot);
    await this.ensureQrSlot();
    return true;
  }

  async shutdown() {
    for (const slot of this.slots) {
      this._clearTimers(slot);
      if (slot.sock) {
        try {
          slot.sock.ev.removeAllListeners();
          slot.sock.end(undefined);
        } catch {
          // ignore
        }
      }
    }
  }
}

module.exports = { SessionManager };
