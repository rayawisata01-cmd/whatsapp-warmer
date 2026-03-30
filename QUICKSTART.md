# 🚀 Quick Start - WhatsApp Warmer

Panduan cepat untuk menjalankan aplikasi dalam 5 menit!

---

## ⚡ LANGKAH CEPAT

### 1. Buka Aplikasi
Klik **Preview** di panel kanan atau buka di tab baru.

### 2. Tambah Akun
1. Klik tombol **"Add WhatsApp Account"** (oranye)
2. Masukkan ID akun (contoh: `test-1`)
3. Pilih **QR Code** atau **Pairing**
4. Klik **Start Session**

### 3. Hubungkan WhatsApp

**Dengan QR Code:**
```
WhatsApp HP → Menu → Perangkat Tertaut → Tautkan Perangkat → Scan QR
```

**Dengan Pairing Code:**
```
Masukkan nomor HP (628xxx) → Dapat kode → Masukkan di WhatsApp HP
```

### 4. Selesai!
Akun akan otomatis:
- ✅ Masuk pool Active/Idle
- ✅ Auto-reply aktif
- ✅ Health score mulai dihitung

---

## 📊 MEMAHAMI TAMPILAN

### Dashboard
| Kotak | Arti |
|-------|------|
| Accounts | Akun online/total |
| Warming | Akun sedang di-warm |
| Active Pool | Sedang chatting |
| Idle Pool | Sedang istirahat |
| Messages | Total pesan |
| Avg Health | Kesehatan rata-rata |

### Status Akun
| Warna | Status |
|-------|--------|
| 🟢 Hijau | Online |
| 🟡 Kuning | Connecting |
| 🔴 Merah | Offline |

### Pool Status
| Pool | Warna Border | Arti |
|------|--------------|------|
| Active | Hijau | Auto-reply AKTIF |
| Idle | Kuning | Istirahat |
| Offline | Abu-abu | Tidak terhubung |

---

## 🔧 TOMBOL PENTING

| Tombol | Fungsi |
|--------|--------|
| Add WhatsApp Account | Tambah akun baru |
| Rotate Pools | Paksa rotasi pool |
| Refresh (⟳) | Refresh data |
| ⋮ (titik tiga) | Menu akun (view/delete) |

---

## ⚠️ TROUBLESHOOT CEPAT

| Masalah | Solusi |
|---------|--------|
| Badge merah "Offline" | Cek WhatsApp Service jalan |
| QR tidak muncul | Refresh halaman, coba lagi |
| Auto-reply tidak jalan | Pastikan pool = Active |
| Langsung disconnect | Hapus akun, buat baru |

---

## 📁 FILE PENTING

```
mini-services/whatsapp-service/
├── sessions/     ← Data session akun
├── backups/      ← Backup otomatis
└── service.log   ← Log aktivitas
```

---

## 💡 TIPS

1. **Mulai dengan 1 akun** untuk testing
2. **Gunakan nomor sekunder** dulu
3. **Jangan kirim manual** - biarkan AI
4. **Pantau health score** - harus di atas 50%
5. **Rotate pools** jika perlu

---

## 🎯 ALUR KERJA

```
[Tambah Akun] → [Scan QR/Pairing] → [Online] → [Masuk Pool] → [Auto-reply Aktif]
                                              ↓
                                    [Rotate Pool Periodik]
                                              ↓
                                    [Health Score Update]
```

---

Baca **TUTORIAL.md** untuk panduan lengkap!
