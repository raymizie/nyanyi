const express = require('express');
const config = require('./config');
const { SessionManager } = require('./whatsapp/sessionManager');

const app = express();
const manager = new SessionManager();

app.use(express.json());
app.use(express.static(config.PUBLIC_DIR));

// Health check untuk Render
app.get('/health', (_req, res) => {
  const state = manager.getPublicState();
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    activeSlots: state.activeCount,
    maxSlots: state.maxSlots,
  });
});

// Status semasa dashboard QR & pengguna aktif
app.get('/api/status', (_req, res) => {
  res.json(manager.getPublicState());
});

// Server-Sent Events (kemas kini masa nyata untuk QR & slot aktif)
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify(manager.getPublicState())}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

manager.on('update', (state) => {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
});

// Jana semula kod QR
app.post('/api/qr/regenerate', async (_req, res) => {
  try {
    const slotId = await manager.regenerateQr();
    res.json({ ok: true, slotId, state: manager.getPublicState() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Gagal menjana semula QR' });
  }
});

// Putuskan satu slot aktif secara manual
app.post('/api/slots/:id/logout', async (req, res) => {
  try {
    const ok = await manager.disconnectSlot(req.params.id, 'Sesi diputuskan dari papan pemuka web.');
    res.json({ ok, state: manager.getPublicState() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Gagal memutuskan sesi' });
  }
});

const server = app.listen(config.PORT, '0.0.0.0', async () => {
  console.log(`🎤 ${config.BOT_NAME} berjalan di http://0.0.0.0:${config.PORT}`);
  console.log(
    `📊 Konfigurasi: ${config.MAX_SLOTS} slot maksimum, had masa ${config.SESSION_DURATION_MINUTES} minit / sesi`
  );
  try {
    await manager.init();
  } catch (err) {
    console.error('Ralat memulakan SessionManager:', err);
  }
});

async function gracefulExit() {
  console.log('\nMenutup pelayan...');
  await manager.shutdown().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);
