# Runbook Teknis Sigap

## Jendela Deploy
Deploy ke produksi Sigap hanya boleh dilakukan pada pukul 10.00 sampai 16.00 WIB.
Deploy pada hari Jumat dilarang kecuali untuk perbaikan insiden.
Setiap deploy wajib punya satu penanggung jawab yang siaga 60 menit setelahnya.

## Prosedur Rollback
Rollback produksi Sigap dilakukan dengan menerapkan ulang tag rilis sebelumnya berpola rel-YYYYMMDD.
Rollback tidak memerlukan persetujuan tambahan jika insiden sedang berjalan.
Rollback yang menyentuh migrasi basis data wajib dikoordinasikan dengan penanggung jawab basis data.

## Tingkat Keparahan Insiden
Sigap memakai tiga tingkat keparahan insiden: P1, P2, dan P3.
P1 berarti layanan tidak bisa diakses oleh sebagian besar pelanggan.
P2 berarti fitur penting terganggu tetapi layanan masih bisa dipakai, dan P3 berarti gangguan kecil tanpa dampak luas.

## Waktu Respons Insiden
Sigap punya SLA waktu respons insiden sebagai berikut.
Insiden P1 wajib direspons dalam 15 menit sejak alarm berbunyi.
Insiden P2 wajib direspons dalam 60 menit, dan insiden P3 dalam 1 hari kerja.
Waktu respons dihitung sampai ada orang yang mengambil alih penanganan, bukan sampai insiden selesai.

## Jadwal On-Call
Giliran on-call Sigap berlangsung satu minggu penuh dan berganti setiap hari Rabu pukul 10.00 WIB.
Setiap giliran on-call diisi satu insinyur utama dan satu cadangan.
Insinyur on-call wajib bisa dihubungi dalam 15 menit selama giliran berjalan.

## Eskalasi
Insiden P1 yang belum tertangani dalam 30 menit dieskalasi ke kepala teknik.
Insiden P1 yang belum tertangani dalam 90 menit dieskalasi ke direktur teknologi.
Eskalasi dilakukan lewat telepon, bukan lewat pesan teks.

## Akses Produksi
Akses ke basis data produksi Sigap dibatasi untuk insinyur tingkat senior ke atas.
Akses sementara bisa diberikan maksimal 8 jam lewat persetujuan kepala teknik.
Semua kueri pada basis data produksi dicatat dan ditinjau setiap bulan.

## Backup Basis Data
Basis data produksi Sigap dicadangkan otomatis setiap 6 jam.
Cadangan disimpan 30 hari lalu dihapus otomatis.
Uji pemulihan cadangan dilakukan setiap kuartal oleh penanggung jawab basis data.

## Halaman Status
Sigap memakai halaman status publik untuk mengumumkan gangguan.
Halaman status wajib diperbarui dalam 30 menit setelah insiden P1 dikonfirmasi.
Pembaruan berikutnya diberikan setiap 60 menit sampai insiden selesai.

## Laporan Pasca-Insiden
Laporan pasca-insiden untuk P1 wajib selesai dalam 5 hari kerja.
Laporan pasca-insiden fokus pada penyebab dan perbaikan sistem, bukan pada individu.
Laporan pasca-insiden disimpan di repositori internal dan terbuka untuk seluruh tim teknik.
