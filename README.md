# Arrow Escape

Game puzzle panah berbasis React + Vite. Panah digambar sebagai garis siku-siku di atas grid, tersusun rapat dan berliku. Ketuk panah yang ujungnya tidak terhalang — panah akan meluncur keluar papan. Bersihkan semua panah untuk naik level.

- **Easy / Medium / Hard** dengan ukuran grid dan jumlah panah berbeda.
- Level bertambah terus; jumlah panah ikut meningkat.
- Skor, 3 nyawa, tombol petunjuk, dan animasi keluar.
- Papan selalu dibuat dengan urutan terbalik sehingga **dijamin bisa diselesaikan**.
- Skor disimpan ke Firestore bila Firebase dikonfigurasi; tanpa konfigurasi, skor tersimpan di browser.

## Menjalankan lokal

```bash
npm install
npm run dev
```

## Firebase / Firestore

1. Buat project Firebase dan aktifkan Firestore Database.
2. Salin `.env.example` menjadi `.env.local`, lalu isi nilai konfigurasi dari Firebase Web App.
3. Terapkan aturan pada `firestore.rules` di Firebase Console.
4. Tambahkan variabel `VITE_FIREBASE_*` yang sama ke Vercel Project Settings → Environment Variables, lalu deploy ulang.

> Firebase Web API key adalah konfigurasi client, bukan kredensial admin. Batasi akses database dengan Firestore Rules.

## Struktur

- `src/game.js` — generator papan, aturan tabrakan, dan pengecekan solvability.
- `src/App.jsx` — layar game, skor, leaderboard, dan integrasi Firebase.
- `src/style.css` — tampilan responsif.

