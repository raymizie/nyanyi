# 🎤 Bot Nyanyi WhatsApp

Bot WhatsApp yang mengenal pasti lagu daripada lirik atau mesej yang di-reply/ditaip, menyesuaikan lirik sekiranya lagu tidak dijumpai, dan **menyanyikannya mengikut irama sebenar** sebagai *Voice Note* WhatsApp.

Direka siap sedia untuk **GitHub + Render** dengan papan pemuka web **QR 10-slot** dan **had masa 60 minit / sesi** (auto-logout & jana QR baharu secara automatik). **100% percuma tanpa sebarang API key.**

---

## ✨ Ciri Utama

- **Pencarian Lagu Pintar (Tanpa API Key):**
  - Pangkalan data lagu & irama sebenar terbina dalam dengan padanan fonetik kabur (*fuzzy matching*) — contohnya taip `sua sue kumoning` tetap dikenali sebagai **Sua Sue Kemoning**.
  - Carian awam percuma selari menggunakan **LRCLIB**, **Deezer**, dan **iTunes**.
- **Mod Hibrid Nyanyian (Voice Note OGG Opus):**
  - Jika lagu sebenar dijumpai dan ada klip audio sebenar, bot menghantar klip lagu sebenar sebagai *Voice Note*.
  - Jika lagu tidak dijumpai (mesej rawak) atau menggunakan arahan `/nyanyi suara`, bot akan **menyesuaikan teks menjadi lirik berirama** dan **menyanyikannya sendiri** (suara TTS yang dilaras pic mengikut lengkuk melodi sebenar + muzik iringan sintetis).
- **Dashboard Web QR Multi-Slot (Render-Ready):**
  - Menyokong sehingga **10 pengguna serentak** (`MAX_SLOTS=10`) menggunakan `@whiskeysockets/baileys` yang ringan pada RAM.
  - Tempoh sesi **60 minit (1 jam)** sebelum auto-logout, kemudian kod QR baharu dijana automatik untuk pengguna seterusnya.
  - Kemas kini masa nyata (SSE) + butang **Jana Semula Kod QR**.

---

## 💬 Arahan WhatsApp

| Arahan | Fungsi |
|---|---|
| Reply mana-mana mesej dengan `/nyanyi` | Cari lagu daripada mesej yang di-reply; jika tiada, sesuaikan jadi lirik & nyanyi ikut irama sebenar |
| `/nyanyi sua sue kumoning` | Cari lagu & terus nyanyikan sebagai *Voice Note* |
| `/nyanyi suara <teks/lirik>` | Paksa nyanyian suara bot bernada + muzik iringan |
| `/nyanyi irama:rasa-sayang <teks>` | Pilih irama khusus daripada pangkalan data |
| `/lagu` | Papar senarai irama sebenar terbina dalam |
| `/masa` | Semak baki masa sesi aktif anda |
| `/bantuan` | Papar panduan ringkas |

---

## 🚀 Cara Muat Naik ke GitHub & Deploy ke Render

### 1. Muat naik ke GitHub
```bash
git init
git add .
git commit -m "Initial commit: Bot Nyanyi WhatsApp"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

### 2. Deploy di Render (Paling Mudah — Guna `render.yaml` / Docker)
1. Buka [Render Dashboard](https://dashboard.render.com).
2. Klik **New +** → **Blueprint** (atau **Web Service**).
3. Sambungkan repositori GitHub anda.
4. Render akan mengesan `render.yaml` dan `Dockerfile` secara automatik (lengkap dengan `ffmpeg` terbina dalam).
5. Klik **Apply / Deploy** dan buka URL Render anda untuk mengimbas kod QR WhatsApp!

> **Tip:** Anda juga boleh ubah pemboleh ubah persekitaran (`Environment Variables`) di Render:
> - `MAX_SLOTS` (lalai: `10`)
> - `SESSION_DURATION_MINUTES` (lalai: `60`)
> - `BOT_NAME` (lalai: `Bot Nyanyi WhatsApp`)

---

## 💻 Menjalankan Secara Tempatan (Local)

```bash
npm install
npm start
```
Kemudian buka `http://localhost:3000` di pelayar web anda.

Untuk menguji enjin carian lagu & sintesis nyanyian:
```bash
npm run test:engine
```
