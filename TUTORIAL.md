# 📱 Tutorial WhatsApp Warmer - Panduan Lengkap untuk Pemula

Selamat datang! Tutorial ini akan membantu Anda menjalankan aplikasi **WhatsApp Warmer** dari awal hingga bisa digunakan. Tutorial ini dibuat untuk pemula yang belum pernah menjalankan aplikasi serupa.

---

## 📋 DAFTAR ISI

1. [Apa Itu WhatsApp Warmer?](#1-apa-itu-whatsapp-warmer)
2. [Yang Anda Butuhkan](#2-yang-anda-butuhkan)
3. [Cara Menjalankan Aplikasi](#3-cara-menjalankan-aplikasi)
4. [Cara Menggunakan Aplikasi](#4-cara-menggunakan-aplikasi)
5. [Memahami Fitur-Fitur](#5-memahami-fitur-fitur)
6. [Mode Tanpa VPS (Testing)](#6-mode-tanpa-vps-testing)
7. [Troubleshooting / Masalah Umum](#7-troubleshooting--masalah-umum)
8. [FAQ (Pertanyaan Umum)](#8-faq-pertanyaan-umum)

---

## 1. APA ITU WHATSAPP WARMER?

**WhatsApp Warmer** adalah aplikasi untuk menghangatkan (warm-up) akun WhatsApp baru agar tidak diblokir oleh WhatsApp.

### Mengapa Perlu Warming?

❌ **Tanpa Warming:**
- Akun baru langsung kirim banyak pesan → BLOKIR!
- Aktivitas mencurigakan → BLOKIR!
- Spam detection → BLOKIR!

✅ **Dengan Warming:**
- Aktivitas bertahap dan natural
- Auto-reply dengan AI yang natural
- Rotasi pool akun (aktif/idle)
- Rate limiting untuk mencegah spam

### Fitur Utama:
- 🤖 **Auto-Reply AI** - Balas pesan otomatis dengan AI yang natural
- 🔄 **Pool Rotation** - Rotasi akun aktif dan idle secara otomatis
- 📊 **Rate Limiting** - Batasi pesan per jam/hari
- 💾 **Auto Backup** - Backup session otomatis
- 📈 **Health Score** - Pantau kesehatan akun
- 👤 **Unique Personality** - Setiap akun punya kepribadian berbeda

---

## 2. YANG ANDA BUTUHKAN

### Untuk Testing (Tanpa VPS):
- ✅ Komputer/Laptop dengan koneksi internet
- ✅ Browser modern (Chrome, Firefox, Edge)
- ✅ Node.js 18+ atau Bun (sudah terinstall di server)
- ✅ Akun WhatsApp untuk testing

### Untuk Production (Dengan VPS):
- ✅ 1 VPS untuk VPS Manager
- ✅ 5 VPS untuk WhatsApp Service (masing-masing 20 akun)
- ✅ Domain + SSL (opsional)
- ✅ IP address yang berbeda untuk setiap VPS

---

## 3. CARA MENJALANKAN APLIKASI

### Langkah 1: Buka Aplikasi

Aplikasi sudah berjalan secara otomatis. Anda hanya perlu membuka:

👉 **Klik tombol "Preview" di panel sebelah kanan**

Atau klik **"Open in New Tab"** untuk membuka di tab baru.

### Langkah 2: Pastikan Semua Service Berjalan

Aplikasi ini terdiri dari beberapa service yang harus berjalan:

| Service | Port | Fungsi |
|---------|------|--------|
| Next.js App | 3000 | Tampilan website |
| WhatsApp Service | 3030 | Koneksi ke WhatsApp |
| VPS Manager | 3050 | Mengelola banyak VPS |

### Langkah 3: Verifikasi Koneksi

Di halaman utama, perhatikan badge di pojok kanan atas:
- 🟢 **Connected** = Siap digunakan
- 🔴 **Offline** = Ada masalah koneksi

---

## 4. CARA MENGGUNAKAN APLIKASI

### 4.1 Menambah Akun WhatsApp Baru

1. **Klik tombol "Add WhatsApp Account"** (warna oranye)
   
2. **Masukkan Account ID**
   - Contoh: `warmer-1`, `akun-test`, `phone-628123456789`
   - Bebas, asal unik (tidak boleh sama dengan yang lain)

3. **Pilih Metode Autentikasi:**

   **Metode QR Code:**
   - Pilih tab "QR Code"
   - Klik "Start Session"
   - Scan QR yang muncul dengan WhatsApp di HP
   - Buka WhatsApp → Menu → Perangkat tertaut → Tautkan perangkat

   **Metode Pairing Code:**
   - Pilih tab "Pairing"
   - Masukkan nomor HP (format: 6281234567890)
   - Klik "Start Session"
   - Masukkan kode pairing di WhatsApp HP

4. **Tunggu hingga status berubah hijau (Online)**

### 4.2 Melihat Daftar Akun

1. Klik tab **"Akun"** di menu atas
2. Anda akan melihat semua akun yang sudah ditambahkan
3. Setiap akun menampilkan:
   - Nama & kepribadian
   - Status (Online/Offline)
   - Pool (Active/Idle)
   - Health Score

### 4.3 Memahami Status Pool

| Pool | Warna | Arti |
|------|-------|------|
| **Active** | Hijau 🟢 | Akun sedang aktif chatting, auto-reply aktif |
| **Idle** | Kuning 🟡 | Akun idle/istirahat, tidak auto-reply |
| **Offline** | Abu-abu ⚪ | Akun tidak terhubung |

### 4.4 Melihat Chat Log

1. Klik tab **"Chat Log"** di menu atas
2. Lihat semua aktivitas chat:
   - 📩 Pesan masuk (Incoming)
   - 📤 Pesan keluar (Outgoing)
   - 🤖 Auto-reply dari AI

### 4.5 Menghapus Akun

1. Di tab "Akun", klik tombol **⋮** (titik tiga) pada akun
2. Pilih **"Delete Account"**
3. Konfirmasi penghapusan

---

## 5. MEMAHAMI FITUR-FITUR

### 5.1 Dashboard

Dashboard menampilkan statistik:

| Statistik | Keterangan |
|-----------|------------|
| **Accounts** | Jumlah akun online / total |
| **Warming** | Akun yang sedang di-warm |
| **Active Pool** | Akun dalam pool aktif |
| **Idle Pool** | Akun dalam pool idle |
| **Messages** | Total pesan terkirim/terima |
| **Avg Health** | Rata-rata health score |

### 5.2 Pool Rotation

**Apa itu Pool Rotation?**
Sistem akan merotasi akun secara berkala antara pool Active dan Idle. Tujuannya:
- Menghindari pola aktivitas yang monoton
- Membuat akun terlihat natural
- Mencegah deteksi spam

**Cara Kerja:**
- Setiap 15-30 menit, sistem merotasi pool
- Akun Active akan diganti dengan akun Idle
- Secara otomatis dan random

### 5.3 Rate Limiting

**Apa itu Rate Limiting?**
Membatasi jumlah pesan yang bisa dikirim per jam dan per hari.

**Batasan Default:**
| Fase | Hari | Maks/Hari | Maks/Jam |
|------|------|-----------|----------|
| 1 | 1 | 10 | 3 |
| 2 | 2 | 15 | 4 |
| 3 | 3 | 20 | 5 |
| ... | ... | ... | ... |
| 30 | 30+ | 100 | 20 |

**Kenapa Penting?**
- Mencegah spam detection
- Aktivitas terlihat natural
- Warming bertahap

### 5.4 Auto-Reply dengan AI

**Cara Kerja:**
1. Pesan masuk dari kontak
2. AI menganalisis konteks
3. AI membuat balasan natural
4. Simulasi typing (seolah-olah manusia)
5. Pesan terkirim

**Contoh Personality:**
```
Nama: Andi, 25 tahun
Pekerjaan: Karyawan swasta
Lokasi: Jakarta
Traits: Ramah, humoris, aktif
Hobi: Musik, gaming, traveling
```

### 5.5 Health Score

**Komponen Health Score:**
- Aktivitas terakhir (semakin baru = skor tinggi)
- Rasio pesan kirim/terima
- Durasi warming
- Status pool

**Interpretasi:**
| Score | Kondisi |
|-------|---------|
| 80-100% | Excellent - Akun sangat sehat |
| 50-79% | Good - Akun sehat |
| 0-49% | Warning - Perlu perhatian |

---

## 6. MODE TANPA VPS (TESTING)

Untuk testing tanpa VPS, aplikasi sudah dikonfigurasi dalam **Local Mode**:

### Arsitektur Local Mode:

```
┌─────────────────────────────────────┐
│         Browser (Anda)              │
│    http://localhost:3000            │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│        Next.js App (Port 3000)      │
│        - Tampilan Web               │
│        - API Routes                 │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   WhatsApp Service (Port 3030)      │
│   - Koneksi ke WhatsApp             │
│   - Auto-reply AI                   │
│   - Pool Management                 │
└─────────────────────────────────────┘
```

### Cara Testing:

1. **Pastikan WhatsApp Service berjalan:**
   ```bash
   cd mini-services/whatsapp-service
   bun run dev
   ```

2. **Buka aplikasi di browser**

3. **Tambah akun dengan QR Code atau Pairing**

4. **Kirim pesan ke akun tersebut dari HP lain**

5. **Lihat auto-reply di Chat Log**

---

## 7. TROUBLESHOOTING / MASALAH UMUM

### Masalah 1: "Failed to connect" / Badge Offline

**Penyebab:**
- WhatsApp Service tidak berjalan
- Port 3030 sudah digunakan aplikasi lain

**Solusi:**
```bash
# Cek apakah service berjalan
curl http://localhost:3030/health

# Jika tidak ada response, jalankan service
cd mini-services/whatsapp-service
bun run dev
```

### Masalah 2: QR Code Tidak Muncul

**Penyebab:**
- Koneksi tidak stabil
- Session sudah ada sebelumnya

**Solusi:**
1. Refresh halaman
2. Hapus akun yang bermasalah
3. Tambah akun baru dengan ID berbeda

### Masalah 3: Akun Langsung Disconnect

**Penyebab:**
- Session korup
- Nomor sudah login di tempat lain

**Solusi:**
1. Hapus folder session:
   ```bash
   rm -rf mini-services/whatsapp-service/sessions/[account-id]
   ```
2. Tambah akun ulang

### Masalah 4: Auto-Reply Tidak Berfungsi

**Penyebab:**
- Akun tidak di pool "Active"
- Rate limit sudah tercapai

**Solusi:**
1. Cek status pool di tab Akun
2. Klik "Rotate Pools" untuk memaksa rotasi
3. Tunggu beberapa menit

### Masalah 5: Error "EADDRINUSE"

**Penyebab:**
Port sudah digunakan aplikasi lain

**Solusi:**
```bash
# Cari proses yang menggunakan port
lsof -i :3000
lsof -i :3030
lsof -i :3050

# Kill proses (ganti PID dengan hasil dari lsof)
kill -9 [PID]
```

---

## 8. FAQ (PERTANYAAN UMUM)

### Q: Apakah aplikasi ini legal?
**A:** Aplikasi ini menggunakan API tidak resmi WhatsApp. Gunakan dengan risiko sendiri. Kami sarankan untuk menggunakan akun sekunder untuk testing.

### Q: Berapa banyak akun yang bisa ditambahkan?
**A:** 
- Local mode: Maksimal 100 akun
- Dengan VPS: 5 VPS × 20 akun = 100 akun

### Q: Apakah bisa multi-device?
**A:** Ya, setiap akun bisa login di device berbeda karena session terpisah.

### Q: Bagaimana cara backup data?
**A:** Sistem otomatis backup setiap 6 jam. Backup disimpan di:
```
mini-services/whatsapp-service/backups/
```

### Q: Kenapa harus warming?
**A:** WhatsApp memiliki algoritma deteksi spam. Akun baru yang langsung aktif mengirim banyak pesan akan dicurigai dan diblokir. Warming membuat aktivitas terlihat natural.

### Q: Bisa tidak pakai AI?
**A:** Bisa, tapi auto-reply akan menggunakan template statis. AI membuat balasan lebih natural dan bervariasi.

### Q: Bagaimana cara deploy ke VPS?
**A:** 
1. Clone repository ke setiap VPS
2. Jalankan WhatsApp Service di VPS worker (port 3030)
3. Jalankan VPS Manager di VPS utama (port 3050)
4. Update konfigurasi vps-config.json dengan IP masing-masing VPS

---

## 📞 BANTUAN LEBIH LANJUT

Jika Anda mengalami masalah yang tidak tercover di tutorial ini:

1. Cek file log:
   ```
   mini-services/whatsapp-service/service.log
   dev.log
   ```

2. Restart semua service

3. Hubungi developer

---

## 🎉 SELAMAT MENCOBA!

Sekarang Anda sudah siap menggunakan WhatsApp Warmer. Mulai dengan menambahkan satu akun untuk testing, lalu amati bagaimana sistem bekerja.

**Tips Penting:**
- ✅ Mulai dengan 1-2 akun untuk testing
- ✅ Gunakan nomor sekunder dulu
- ✅ Pantau health score
- ✅ Jangan spam dengan manual
- ✅ Biarkan sistem bekerja otomatis

Semoga sukses! 🚀
