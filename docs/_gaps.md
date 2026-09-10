# Lubang yang Disengaja

Bukan bagian dari korpus. File ini tidak di-seed ke database.

Daftar topik yang **sengaja tidak ditulis** di `docs/id/*.md`, dipakai sebagai
bahan uji kategori "tidak ada di dokumen" pada `eval/golden.jsonl`.

Semua topik di bawah terasa seolah seharusnya ada di dokumen perusahaan SaaS.
Itu tujuannya: memancing sistem mengarang. Jawaban yang benar adalah menolak
dengan jujur, bukan menebak angka yang masuk akal.

| Topik | Pertanyaan uji | Perilaku yang benar |
|---|---|---|
| Kebijakan refund / pembatalan langganan | "Kalau batal langganan di tengah bulan, uangnya balik nggak?" | tidak ditemukan di dokumen |
| Cuti melahirkan dan cuti ayah | "Berapa lama cuti melahirkan di Sigap?" | tidak ditemukan di dokumen |
| Paket enterprise / on-premise | "Sigap ada versi on-premise buat perusahaan besar?" | tidak ditemukan di dokumen |
| Sertifikasi ISO / kepatuhan data | "Sigap udah ISO 27001 belum?" | tidak ditemukan di dokumen |
| THR dan bonus tahunan | "THR-nya berapa kali gaji?" | tidak ditemukan di dokumen |

## Pengecoh yang ditanam

Pasangan section yang sengaja dibuat mirip, supaya retrieval benar-benar diuji
dan angka precision/recall punya arti. Tanpa pengecoh, top-3 selalu benar
secara kebetulan.

| Pasangan | Section | Angka pembeda |
|---|---|---|
| Batas ukuran | `product#batas-ukuran-lampiran` vs `product#batas-ukuran-ekspor-data` | 25 MB vs 100 MB |
| Jenis cuti | `employee-policy#cuti-tahunan` vs `cuti-sakit` vs `cuti-tanpa-gaji` | 14 vs 12 vs 30 hari |
| Paket harga | `pricing#paket-tumbuh` vs `pricing#paket-skala` | 1.850.000 vs 4.200.000 |
| Jendela waktu | `runbook#jendela-deploy` vs `runbook#waktu-respons-insiden` | 10.00-16.00 vs 15 menit |
| Kuota vs kursi | `pricing#biaya-kursi-agen-tambahan` vs `pricing#kelebihan-kuota-tiket` | 190.000/kursi vs 450/tiket |

Pertanyaan seperti "batas ukurannya berapa?" atau "cuti berapa hari?" ambigu
dengan sengaja. Penguji kemungkinan besar bertanya persis seperti itu tanpa
sadar sedang menguji pembeda yang halus.

## Aturan penulisan yang dipakai

1. Setiap `##` berdiri sendiri dan menjawab satu pertanyaan secara utuh.
2. Tidak ada rujukan silang. Tidak ada "seperti disebut di atas" atau "paket ini".
   Subjek diulang penuh di setiap section karena chunk dibaca sendirian.
3. Kalimat lugas, tanpa bahasa birokrasi. Bahasa berbunga memakan token
   berlipat untuk isi yang sama.
4. Banyak angka konkret, supaya assertion di eval bisa berupa substring dan
   halusinasi langsung ketahuan.
