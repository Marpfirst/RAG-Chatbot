# Catatan kasar

Bahan mentah untuk NOTES.md. Tidak dirapikan, tidak dikirim.

## Keputusan yang diambil dan alasannya

- **Routing lewat tool-calling, bukan call klasifikasi terpisah.** Call
  klasifikasi bikin tiap pertanyaan gampang bayar 2x. Di sini keputusan routing
  = giliran normal manager, gratis.
- **Manager dan specialist pakai model yang sama (mini).** Tugas specialist itu
  ekstraksi dari konteks yang sudah dipersempit, bukan penalaran. Kalau eval
  nanti bilang beda, baru naikkan — dan ada angkanya.
- **Chunking structure-aware, overlap 0%.** Konvensi bilang 10-20%, tapi overlap
  itu obat untuk batas potong yang ditebak chunker. Batas di sini ditulis
  tangan. Overlap = token duplikat di tiap retrieval.
- **Korpus bahasa Indonesia walau lebih boros ~15%.** Dokumen Inggris lebih
  murah, tapi menambah mode gagal yang kelihatan langsung saat penguji bertanya
  dalam bahasa Indonesia. Keputusan risiko, bukan keputusan token.
- **History cuma ke manager, tidak ke specialist.** Manager sudah menormalkan
  pertanyaan jadi query mandiri saat memanggil tool, jadi riwayat percakapan
  cuma beban mati di call yang lebih mahal.
- **Similarity floor.** Pertanyaan di luar korpus jadi salah satu jalur
  TERMURAH: 0 chunk dikirim, specialist di-skip sama sekali, jawaban tetap
  "tidak ada di dokumen". Mekanis, tidak bergantung kepatuhan model.
- **Pagar rule-based untuk kasus terburuk.** max_tokens di server, tolak input
  >1000 karakter sebelum call API, batas laju 10 pesan/menit, dan tier-3 di
  prompt manager yang menolak permintaan di luar domain dengan ~20 token.
  Rata-rata gampang dipoles; yang berbahaya ekornya.
- **Tanpa index ANN.** 38 baris, sequential scan instan. ivtflat butuh ribuan
  baris sebelum list-nya berarti.
- **Grading pakai substring, bukan LLM judge.** Membakar token untuk menilai
  tugas hemat token itu konyol, dan semua fakta di korpus berupa angka/nama.

## Yang bikin mentok

(diisi sambil jalan)

## Angka

(diisi setelah eval baseline + tiap langkah optimasi)

| Langkah | avg token | pass | recall@3 |
|---|---|---|---|
| v0 naif | | | |

## Diketahui masih kurang

- Threshold dikalibrasi dari 16 pertanyaan saja. Sampel kecil.
- Pencarian murni vektor. Identifier eksak (nama paket, pola tag `rel-*`) bisa
  meleset. Di 38 chunk belum jadi masalah; di korpus besar hybrid search yang
  pertama saya tambahkan.
- History dikirim mentah 4 pesan, belum diringkas. Di percakapan panjang ini
  jadi boros.
- Kalau manager salah menormalkan pertanyaan jadi query, retrieval ikut salah
  dan tidak ada mekanisme perbaikan. Tidak ada retry.
