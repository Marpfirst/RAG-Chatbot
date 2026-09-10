# Catatan Take-Home — Sigap Assistant

## 1. Logika Routing

Semua pertanyaan masuk ke Manager. Manager punya satu tool, `search_docs`, dan
routing terjadi **di dalam call yang memang sudah dibayar**: Manager
mengembalikan jawaban, atau sebuah tool call. Tidak ada classifier terpisah —
call klasifikasi tambahan membuat setiap pertanyaan membayar dua kali, dalam
token dan dalam latensi.

Tiga keputusan:

- Butuh fakta yang hanya ada di dokumen Sigap → `search_docs` → Specialist
  menjawab dengan grounding.
- Tidak butuh, tapi topiknya masih di domain asisten ini (dukungan pelanggan,
  praktik helpdesk, mengoperasikan produk SaaS) → Manager menjawab sendiri,
  maksimal 3 kalimat.
- Di luar itu → tolak dalam satu kalimat.

Yang **bukan** kriteria: panjang pertanyaan, huruf besar-kecilnya, dan panjang
jawaban yang akan keluar. Ketiganya sempat dipakai sebagai proksi dan ketiganya
salah.

"Sigap" sendiri diperlakukan sebagai topik dokumen, karena definisinya memang
ada di `product.md`.

## 2. Penghematan Token

Semua angka dibaca dari field `usage` API, bukan diestimasi, dan tersimpan di
`eval/results/`.

| Tahap | Token/pertanyaan | Set soal |
|---|---:|---|
| Baseline naif — seluruh korpus tiap request | 2.654 | 18 |
| Arsitektur optimal | ~818 | 34 |
| **Final** | **843** | **42** |

Angkanya tidak sebanding langsung karena set soalnya bertambah; yang sebanding
adalah perbandingan sebelum-sesudah di dalam set yang sama, dan itu yang dipakai
setiap kali ada perubahan. Baseline naif masih ada di repo (`NAIVE_MODE=true`)
supaya angka "sebelum" bisa direproduksi, bukan sekadar dipercaya.

Yang paling berdampak: retrieval top-k (mengirim ~250 token konteks, bukan
seluruh korpus), pagar `max_tokens`, penolakan singkat untuk di luar domain, dan
memadatkan peta dokumen di system prompt.

Final sedikit lebih tinggi dari 818, dan itu disengaja: perbaikan routing membuat
pertanyaan tentang Sigap yang dulu ditolak sekarang benar-benar mengambil
dokumen — dua call, bukan satu.

Kompresi prompt yang lebih agresif sudah diuji dan turun ke 694 token, tapi
correctness ikut turun jadi 32/34, sehingga dibatalkan
(`eval/results/rejected-prompt-compression.json`). **Saya mengoptimalkan token
serendah mungkin yang masih menjaga correctness routing dan jawaban, bukan token
seminimal mungkin.**

## 3. Pengujian Correctness

`eval/golden.jsonl` — 42 pertanyaan, tujuh kategori: umum, batas cakupan, butuh
dokumen, perbandingan dua section, tidak ada di dokumen, di luar domain, dan
pertanyaan susulan yang bergantung pada riwayat.

Pengukurannya tiga lapis supaya regresi bisa dilacak ke lapisan penyebabnya:
rute yang diambil, recall/precision terhadap chunk yang diharapkan, dan assertion
substring pada teks jawaban. Penilaian pakai substring, bukan LLM judge —
membakar token untuk menilai tugas hemat token itu kontradiktif, dan semua fakta
di korpus berupa angka atau nama.

**Hasil final: 40/42 lulus, recall@k 100%, rata-rata 843 token.**
`npm run repro` memutar ulang satu percakapan 8 giliran untuk menguji konsistensi
antar-giliran, yang tidak terlihat kalau soal diuji satu per satu.

Satu pelajaran yang mahal: alat ukurnya sendiri sempat salah tiga kali. Assertion
yang hanya memeriksa rute meloloskan penolakan, karena penolakan juga "dijawab
Manager". Yang akhirnya menangkapnya jauh lebih sederhana — ambang panjang output
minimum.

## 4. Kendala Terbesar

Batas routing.

Versi awal menangani atribut Sigap dengan baik — harga, SLA, kebijakan cuti —
tapi menolak pertanyaan tingkat entitas seperti "Apa itu Sigap?". Asisten menolak
menjelaskan produknya sendiri sambil menawarkan bantuan soal "kebijakan internal
kami" di kalimat yang sama.

Akar masalahnya: instruksi routing mendaftar **atribut** Sigap, bukan menyatakan
Sigap sendiri sebagai topik dokumen. Buktinya presisi — "Sigap adalah **produk**
apa?" berhasil sementara "Apa itu Sigap?" gagal; kata "produk" yang
menyelamatkannya.

Selesai dengan satu aturan umum: pesan tentang Sigap itu sendiri selalu lewat
dokumen. Bukan pengecualian per pertanyaan. Hasilnya, diukur: routing failure
8 → 1, recall@k 80% → 100%.

## 5. Keterbatasan yang Disadari

"Apa itu reimbursement?" masih bisa ditolak. Istilah itu bisa dibaca dua arah:
konsep umum, atau permintaan kebijakan reimbursement perusahaan. Spesifikasi
tugasnya tidak mendefinisikan batas itu, jadi tidak ada kunci jawaban yang bisa
saya klaim benar.

Saya memilih tidak menambah pengecualian per pertanyaan, karena tiap pengecualian
membuat router makin rapuh — dan itu sudah terbukti di proyek ini: tiap tambalan
melahirkan blind spot berikutnya.

## 6. Kerja Saya vs Bantuan AI

**Saya yang merancang dan memutuskan:** arsitektur, batas tanggung jawab
Manager/Specialist, kebijakan routing, strategi retrieval, trade-off token vs
correctness, kriteria evaluasi, dan keputusan teknis final.

**Saya implementasikan dan integrasikan:** aplikasi Next.js, integrasi Supabase,
alur chat dan riwayat, pipeline retrieval, pencatatan token, dan konfigurasi
deployment.

**Dibantu AI:** boilerplate implementasi, debugging, pembuatan test case, review
kode, eksperimen optimisasi, dan penyuntingan dokumentasi.

AI dipakai sebagai asisten teknis. Setiap trade-off arsitektural saya evaluasi
sendiri terhadap angka pengukuran, bukan diterima begitu saja — beberapa usulan
justru saya batalkan setelah diukur, dan pembatalan itu tercatat di tabel token
di atas.
