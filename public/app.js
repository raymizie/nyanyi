(() => {
  const el = {
    botTitle: document.getElementById('botTitle'),
    activeCount: document.getElementById('activeCount'),
    freeCount: document.getElementById('freeCount'),
    sessionLimit: document.getElementById('sessionLimit'),
    noteMinutes: document.getElementById('noteMinutes'),
    qrStatusPill: document.getElementById('qrStatusPill'),
    qrLoading: document.getElementById('qrLoading'),
    qrImage: document.getElementById('qrImage'),
    qrFullMsg: document.getElementById('qrFullMsg'),
    regenBtn: document.getElementById('regenBtn'),
    slotSummaryText: document.getElementById('slotSummaryText'),
    activeUsersBox: document.getElementById('activeUsersBox'),
  };

  let latestState = null;
  let serverOffsetMs = 0;

  function formatCountdown(ms) {
    const safe = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderActiveUsers(state) {
    const users = state.activeSlots || [];
    const totalMs = (state.sessionDurationMinutes || 60) * 60 * 1000;
    const nowServer = Date.now() + serverOffsetMs;

    if (!users.length) {
      el.activeUsersBox.classList.remove('has-users');
      el.activeUsersBox.innerHTML = `
        <div class="empty-state">
          <p class="empty-title">Tiada pengguna sedang bersambung buat masa ini.</p>
          <p class="empty-sub">Imbas kod QR di sebelah untuk mula menggunakan Bot Nyanyi.</p>
        </div>
      `;
      return;
    }

    el.activeUsersBox.classList.add('has-users');
    el.activeUsersBox.innerHTML = users
      .map((u) => {
        const remMs = Math.max(0, (u.expiresAt || nowServer) - nowServer);
        const pct = Math.max(0, Math.min(100, (remMs / totalMs) * 100));
        return `
          <div class="user-row" data-slot="${u.id}">
            <div class="user-main">
              <div class="user-top">
                <span class="slot-tag">Slot #${u.id}</span>
                <span class="user-name">${escapeHtml(u.pushName)}</span>
                <span class="user-phone">${escapeHtml(u.phone)}</span>
              </div>
              <div class="user-meta">
                <span>Baki masa: <span class="time-left">${formatCountdown(remMs)}</span></span>
                <span>🎵 ${u.songsSung || 0} lagu</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width: ${pct.toFixed(1)}%"></div>
              </div>
            </div>
            <button class="btn-disconnect" type="button" data-logout="${u.id}">Putus</button>
          </div>
        `;
      })
      .join('');
  }

  function renderState(state) {
    if (!state) return;
    latestState = state;
    if (state.serverTime) {
      serverOffsetMs = state.serverTime - Date.now();
    }

    el.botTitle.textContent = state.botName || 'Bot Nyanyi WhatsApp';
    el.activeCount.textContent = `${state.activeCount} / ${state.maxSlots}`;
    el.freeCount.textContent = `${state.freeCount}`;
    el.sessionLimit.textContent = `${state.sessionDurationMinutes} minit / sesi`;
    const hoursNote =
      state.sessionDurationMinutes === 60
        ? '60 minit (1 jam)'
        : `${state.sessionDurationMinutes} minit`;
    el.noteMinutes.textContent = hoursNote;
    el.slotSummaryText.textContent = `${state.activeCount} daripada ${state.maxSlots} slot`;

    // QR card state
    const pending = state.pendingSlot;
    if (!pending && state.freeCount === 0) {
      el.qrStatusPill.textContent = `⛔ SEMUA SLOT PENUH (${state.activeCount} / ${state.maxSlots})`;
      el.qrStatusPill.className = 'status-pill status-full';
      el.qrLoading.classList.add('hidden');
      el.qrImage.classList.add('hidden');
      el.qrFullMsg.classList.remove('hidden');
      el.regenBtn.disabled = true;
    } else if (pending && pending.status === 'qr' && pending.qrDataUrl) {
      el.qrStatusPill.textContent = `⏳ IMBAS KOD QR (Slot #${pending.id} / ${state.maxSlots})`;
      el.qrStatusPill.className = 'status-pill status-waiting';
      el.qrImage.src = pending.qrDataUrl;
      el.qrImage.classList.remove('hidden');
      el.qrLoading.classList.add('hidden');
      el.qrFullMsg.classList.add('hidden');
      el.regenBtn.disabled = false;
    } else {
      const slotLabel = pending ? `Slot #${pending.id}` : 'Slot Baharu';
      el.qrStatusPill.textContent = `⏳ MENJANA KOD QR (${slotLabel} / ${state.maxSlots})`;
      el.qrStatusPill.className = 'status-pill status-waiting';
      el.qrImage.classList.add('hidden');
      el.qrFullMsg.classList.add('hidden');
      el.qrLoading.classList.remove('hidden');
      el.regenBtn.disabled = false;
    }

    renderActiveUsers(state);
  }

  // Butang Jana Semula Kod QR
  el.regenBtn.addEventListener('click', async () => {
    el.regenBtn.disabled = true;
    el.qrImage.classList.add('hidden');
    el.qrFullMsg.classList.add('hidden');
    el.qrLoading.classList.remove('hidden');
    try {
      const res = await fetch('/api/qr/regenerate', { method: 'POST' });
      const data = await res.json();
      if (data.state) renderState(data.state);
    } catch {
      // SSE/poll akan pulihkan paparan
    } finally {
      setTimeout(() => {
        el.regenBtn.disabled = false;
      }, 1500);
    }
  });

  // Delegasi butang Putus untuk setiap slot aktif
  el.activeUsersBox.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-logout]');
    if (!btn) return;
    const slotId = btn.getAttribute('data-logout');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch(`/api/slots/${slotId}/logout`, { method: 'POST' });
      const data = await res.json();
      if (data.state) renderState(data.state);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Putus';
    }
  });

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        renderState(await res.json());
      }
    } catch {
      // ignore transient network drop
    }
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      try {
        renderState(JSON.parse(event.data));
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
      setTimeout(connectEvents, 3000);
    };
  }

  // Kemas kini kiraan detik setiap 1 saat pada paparan tempatan
  setInterval(() => {
    if (latestState && latestState.activeSlots && latestState.activeSlots.length) {
      renderActiveUsers(latestState);
    }
  }, 1000);

  // Fallback polling ringan setiap 15 saat
  setInterval(fetchStatus, 15000);

  fetchStatus();
  connectEvents();
})();
