const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_BASE = path.join(os.tmpdir(), 'bot-nyanyi-whatsapp');

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  BOT_NAME: process.env.BOT_NAME || 'Bot Nyanyi WhatsApp',
  MAX_SLOTS: Math.max(1, Math.min(20, parseInt(process.env.MAX_SLOTS || '10', 10))),
  SESSION_DURATION_MINUTES: Math.max(
    1,
    parseInt(process.env.SESSION_DURATION_MINUTES || '60', 10)
  ),
  get SESSION_DURATION_MS() {
    return this.SESSION_DURATION_MINUTES * 60 * 1000;
  },
  SESSIONS_DIR: process.env.SESSIONS_DIR || path.join(RUNTIME_BASE, 'sessions'),
  TMP_DIR: process.env.TMP_DIR || path.join(RUNTIME_BASE, 'tmp'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  HTTP_TIMEOUT_MS: 8000,
};
