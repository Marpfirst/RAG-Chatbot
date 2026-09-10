# Produk Sigap

## Ringkasan Produk
Sigap adalah layanan helpdesk berbasis web untuk tim dukungan pelanggan di Indonesia.
Sigap mengumpulkan pesan pelanggan dari berbagai kanal menjadi satu antrean tiket.
Sigap dipakai lewat browser dan tidak menyediakan aplikasi desktop.

## Kanal Masuk Tiket
Sigap menerima tiket dari lima kanal: email, formulir web, WhatsApp Business, Instagram Direct Message, dan Tokopedia Chat.
Setiap kanal masuk ke antrean yang sama dan diberi label kanal asal secara otomatis.
Kanal Telegram dan Facebook Messenger belum tersedia di Sigap.

## Batas Ukuran Lampiran
Satu lampiran pada tiket Sigap maksimal 25 MB.
Satu tiket boleh memuat paling banyak 10 lampiran.
Format yang ditolak Sigap adalah .exe, .bat, dan .sh.

## Batas Ukuran Ekspor Data
Satu berkas hasil ekspor data Sigap maksimal 100 MB.
Ekspor yang melebihi 100 MB dipecah otomatis menjadi beberapa berkas.
Tautan unduhan hasil ekspor Sigap berlaku 72 jam.

## Retensi Tiket
Sigap menyimpan tiket yang sudah ditutup selama 12 bulan.
Setelah 12 bulan, tiket dipindahkan ke arsip dingin dan tidak lagi muncul di pencarian biasa.
Tiket di arsip dingin bisa dipulihkan lewat permintaan ke tim dukungan Sigap dalam 5 hari kerja.

## Integrasi
Sigap punya integrasi resmi dengan Slack, Google Sheets, Xendit, dan Midtrans.
Integrasi Slack mengirim notifikasi tiket baru ke kanal yang dipilih.
Integrasi Google Sheets menyalin ringkasan tiket harian ke satu spreadsheet.

## Otomasi dan Aturan Tiket
Sigap mengizinkan maksimal 20 aturan otomasi aktif per akun.
Setiap aturan berbentuk pemicu, syarat, dan tindakan.
Aturan otomasi Sigap dijalankan berurutan dari atas ke bawah dan berhenti pada aturan pertama yang cocok.

## Batas Panggilan API
API Sigap membatasi 120 panggilan per menit per akun.
Panggilan yang melebihi batas mendapat kode 429 dan boleh diulang setelah 60 detik.
Kunci API Sigap dibuat dari menu Pengaturan dan berlaku sampai dicabut manual.

## Bahasa Antarmuka
Antarmuka Sigap tersedia dalam Bahasa Indonesia dan Bahasa Inggris.
Bahasa dipilih per pengguna, bukan per akun.
Isi tiket tidak diterjemahkan otomatis oleh Sigap.
