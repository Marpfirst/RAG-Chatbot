# Catatan — Sigap Assistant

Semua angka di sini hasil pengukuran, bukan estimasi. Diambil dari `usage` yang
dikembalikan API OpenAI, disimpan di `eval/results/*.json`, dan bisa
direproduksi dengan `npm run eval`.

---

## 1. Bagaimana manager memutuskan jawab sendiri vs lempar ke specialist

Routing terjadi **di dalam call manager yang memang sudah dibayar**, lewat
tool-calling. Manager tidak mengembalikan label lalu dipanggil lagi — dia
mengembalikan jawaban, atau sebuah `search_docs` tool call. Pendekatan "call
klasifikasi terpisah" membuat setiap pertanyaan gampang membayar dua kali; di
sini routing tidak menambah biaya sama sekali.

Aturannya tiga tingkat, bukan dua:

| Jenis | Contoh | Rute |
|---|---|---|
| Butuh fakta tentang Sigap | "Berapa harga paket Tumbuh?" | `search_docs` → specialist |
| Umum tapi relevan domain | "Apa itu SLA?" | manager jawab, maks 3 kalimat |
| Di luar domain | "Tulis esai 2000 kata" | manager tolak, satu kalimat |

Tingkat ketiga sengaja ada. "Pertanyaan umum" yang tak berbatas adalah lubang
token: tanpa tingkat itu, permintaan esai dijawab patuh dan badge menampilkan
ribuan token.

Dasar keputusannya adalah **peta dokumen** di system prompt manager — nama
dokumen plus beberapa judul section. Saat ragu, manager condong ke specialist.
Pertanyaan yang menyebut Sigap **selalu** lewat retrieval, bahkan ketika model
merasa sudah tahu jawabannya; itu menutup satu mode halusinasi dengan biaya
~35 token per pertanyaan.

Pengaman kedua bersifat mekanis: kalau tidak ada chunk yang melewati ambang
kemiripan, specialist tidak dipanggil sama sekali dan sistem menjawab "tidak ada
di dokumen". Jadi pertanyaan di luar korpus termasuk **jalur termurah**, bukan
termahal.

---

## 2. Apa yang dilakukan untuk menurunkan token, dan angkanya

Baseline adalah v0 yang sengaja naif — seluruh korpus ditempel di setiap
request, seluruh riwayat dikirim, tanpa retrieval, tanpa batas output. Masih ada
di repo sebagai `NAIVE_MODE=true`, jadi angka "sebelum" bisa diverifikasi
sendiri, bukan sekadar dipercaya.

| Langkah | avg token | Lulus | Catatan |
|---|---|---|---|
| v0 naif (baseline) | **2.654** | — | seluruh korpus + riwayat penuh |
| + routing tool-call & top-k retrieval | 586 | 15/16 | penurunan terbesar |
| + pertanyaan Sigap wajib lewat retrieval | 621 | 16/16 | +35 tok, tutup halusinasi |
| + peta dokumen dipadatkan | 512 | 16/16 | 38 judul → 4 judul per dokumen |
| + `k` diturunkan 3 → 1 | 456 | 16/16 | **ternyata palsu, lihat §3** |
| golden set diperbaiki (16 → 18 soal) | 467 | 16/18 | `k=1` langsung patah |
| + specialist terima pertanyaan asli | 547 | 17/18 | |
| + ambang kemiripan dikalibrasi | 540 | 16/18 | out-of-scope 599 → 441 |
| + embed pertanyaan asli + query manager | **619** | **18/18** | konfigurasi final |

**2.654 → 619 token, turun 77%**, dengan 18/18 lulus.

Per kategori:

| Kategori | Naif | Final | Turun |
|---|---|---|---|
| Pertanyaan umum | 2.640 | 393 | 85% |
| Butuh dokumen | 2.519 | 774 | 69% |
| Perbandingan dua section | 2.636 | 772 | 71% |
| Tidak ada di dokumen | 2.554 | 599 | 77% |
| Permintaan di luar domain | 3.296 | 363 | 89% |

Yang paling berdampak, berurutan: **top-k retrieval** (mengirim ~250 token
konteks, bukan 3.034), **pagar `max_tokens` plus penolakan di luar domain**
(kasus terburuk turun dari 3.885 jadi ~370 token), lalu **memadatkan peta
dokumen**.

Perhatikan arah tabelnya: angka turun sampai 456, lalu **naik lagi** ke 619.
Kenaikan itu disengaja — setiap kenaikan membeli satu perbaikan kebenaran yang
terukur. Konfigurasi termurah bukan yang terbaik.

### Yang dicoba lalu ditolak

- **`k=1` dan `k=2`.** Lulus 16/16 dan hemat ~90 token. Ternyata golden set-nya
  yang terlalu gampang (lihat §3), bukan `k`-nya yang aman.
- **Peta dokumen hanya nama dokumen** (~40 token, hemat 61 token lagi). Ditolak:
  judul section bukan cuma sinyal routing, tapi **kosakata** yang dipakai manager
  untuk menulis query mandiri. Tanpa itu, "kalau yang paketnya lebih besar?"
  gagal walaupun chunk yang benar tetap terambil.
- **Adaptive-k** (ambil 5, buang yang skornya jauh dari teratas). Terlihat rapi
  di atas kertas, hasilnya lebih buruk di dua ambang yang dicoba. Kodenya masih
  ada, dimatikan lewat `RELATIVE_GAP=1`.
- **Ambang 0,49.** Membuat out-of-scope sangat murah (599 → 358) tapi ikut
  membunuh pertanyaan perbandingan dan pertanyaan susulan. Dipakai 0,40.
- **Prompt caching.** Tidak bisa: ambang cache OpenAI 1.024 token, prompt kita
  ~390. Sistemnya sudah terlalu kecil untuk mendapat manfaat caching.

  Ada ironi yang terlihat di `usage_log`: caching justru **aktif di baseline
  naif**, yang prompt-nya 2.500 token — 2.432 di antaranya terbaca dari cache.
  Jadi dalam hitungan rupiah baseline naif tidak semahal kelihatannya. Dalam
  hitungan token, yang jadi kriteria di sini, tetap 2.654. Kalau yang dioptimasi
  adalah biaya dan bukan token, sebagian keputusan di dokumen ini akan berbeda.

### Keputusan lain yang menghemat

- Chunking per heading, **overlap 0%**. Konvensi menyarankan 10-20%, tapi overlap
  adalah obat untuk batas potong yang ditebak mesin. Batas di sini ditulis
  tangan; overlap hanya akan menduplikasi token di setiap retrieval.
- **Riwayat percakapan hanya ke manager**, tidak ke specialist. Manager sudah
  menormalkan pertanyaan saat memanggil tool, jadi riwayat jadi beban mati di
  call yang lebih mahal.
- Manager dan specialist memakai **model yang sama** (`gpt-4o-mini`). Tugas
  specialist adalah ekstraksi dari konteks yang sudah dipersempit, bukan
  penalaran. Menaikkan model tidak pernah dicoba karena akurasi belum jadi
  masalah.
- Tanpa index ANN. 38 baris, sequential scan instan; `ivfflat` butuh ribuan baris
  sebelum list-nya berarti.

---

## 3. Bagaimana memastikan jawabannya masih benar

`eval/golden.jsonl` — 18 pertanyaan, enam kategori: umum, butuh dokumen,
perbandingan dua section, tidak ada di dokumen, permintaan di luar domain, dan
pertanyaan susulan yang bergantung pada riwayat. Dua di antaranya berbahasa
Inggris.

Pengukurannya tiga lapis, supaya regresi bisa dilacak ke lapisan penyebabnya:

- **routing** — rute yang diambil sesuai harapan?
- **recall@k / precision@k** — chunk yang benar terambil?
- **assertion jawaban** — fakta kunci muncul di teks?

Penilaian pakai substring, bukan LLM judge. Membakar token untuk menilai tugas
hemat token itu kontradiktif, dan semua fakta di korpus berupa angka atau nama.

Korpusnya perusahaan fiktif. Itu disengaja: model tidak mungkin tahu harga paket
Tumbuh dari pelatihannya, jadi jawaban yang benar membuktikan retrieval bekerja,
bukan kebetulan. Korpus juga menanam pengecoh yang mirip (cuti tahunan / cuti
sakit / cuti tanpa gaji; batas lampiran 25 MB vs batas ekspor 100 MB) supaya
angka precision dan recall punya arti.

**Temuan terpenting: alat ukurnya sendiri sempat salah.** Sampai iterasi keenam,
setiap pertanyaan memetakan ke tepat satu chunk. Akibatnya `k=1` menang secara
struktural, dan saya hampir memakainya. Setelah menambah dua pertanyaan
perbandingan yang butuh dua chunk sekaligus, `k=1` langsung turun ke 89% recall.
Golden set yang terlalu mudah lebih berbahaya daripada tidak punya golden set,
karena memberi rasa aman yang keliru.

**Variansi.** `temperature: 0` di OpenAI tidak sepenuhnya deterministik. Dua run
pada konfigurasi identik memberi 512 dan 510 token dengan kegagalan yang sama,
jadi cukup stabil. Tapi beberapa selisih kecil di iterasi awal kemungkinan derau
— angka pada tabel §2 adalah run tunggal per langkah, kecuali baris final.

**Kejujuran soal baseline.** Baseline naif tercatat 0/18, tapi itu sebagian
besar artefak alat ukur: tanpa routing, setiap rute otomatis dianggap salah;
tanpa retrieval, setiap chunk dianggap meleset. Dinilai dari isi jawabannya
saja, baseline naif benar di 15 dari 18 soal dan **tidak berhalusinasi** pada
pertanyaan di luar dokumen — dia menolak, hanya dengan kalimat berbeda dari yang
di-assert. Kegagalan aslinya dua: satu pertanyaan berbahasa Inggris dijawab
tidak lengkap, dan output tak terbatas pada permintaan esai (1.143 token output
dalam satu jawaban). Jadi klaim yang benar adalah **"77% lebih hemat dengan
kebenaran setara atau lebih baik"**, bukan "0/18 menjadi 18/18".

---

## 4. Bagian yang paling bikin mentok

Pertanyaan perbandingan: *"Bedanya paket Tumbuh sama paket Skala apa?"*

Gagal berulang kali dengan tiga sebab berbeda yang saling menutupi:

1. Chunk teratas justru `pricing#diskon-pembayaran-tahunan` (0,614) — section itu
   kebetulan menyebut kedua nama paket, jadi mengalahkan dua chunk yang benar
   (0,538 keduanya). Pengecoh yang saya tanam sendiri bekerja terlalu baik.
2. Specialist menerima **query hasil tulisan ulang manager**, bukan pertanyaan
   asli. Manager mempersempitnya jadi satu frasa dan kata "Skala" hilang sebelum
   retrieval berjalan.
3. Instruksi yang saya tambahkan untuk memperbaikinya — *"jawab semua bagian
   pertanyaan"* — bertabrakan dengan instruksi *"tolak kalau tidak ada di
   konteks"*. Specialist punya satu dari dua chunk, sadar hanya bisa menjawab
   separuh, lalu menolak seluruhnya. Recall 0,5 tapi jawaban nol.

Keluarnya dengan berhenti menebak dan mulai melihat data. `scripts/probe.ts`
mencetak sebaran skor kemiripan untuk sekumpulan query, dan dari situ ketiga
sebab langsung terlihat. Perbaikannya: **embed pertanyaan asli digabung query
manager** (~5 token tambahan, mempertahankan nama entitas sekaligus resolusi
kata ganti), dan izinkan specialist menjawab sebagian sambil menyebut bagian
yang tidak ada.

Skrip probe itu juga jadi dasar kalibrasi ambang: pertanyaan dalam korpus
mendapat skor 0,55-0,69, di luar korpus 0,28-0,44. Ambang 0,40 duduk di celah
itu — diukur, bukan ditebak.

---

## 5. Mana ide sendiri, mana ditulis sendiri, mana dibantu AI

Dikerjakan bersama Claude, dan pembagiannya kira-kira begini.

**Keputusan arah** — dibahas bolak-balik dulu, bukan diterima mentah. Yang saya
dorong: memakai perusahaan fiktif supaya batas routing tajam dan halusinasi
langsung ketahuan; korpus berbahasa Indonesia walau lebih boros token, karena
risiko gagal di depan penguji lebih mahal daripada 15% token; dan kekhawatiran
bahwa "manager boleh jawab pertanyaan umum" adalah lubang token yang bisa
disalahgunakan — dari situ lahir tingkat ketiga di aturan routing beserta
seluruh pagar rule-based.

**Ditulis AI** — hampir semua kode: scaffold Next.js, skrip seed dan eval,
komponen UI, skema SQL, dan isi dokumen korpus.

**Hasil kolaborasi** — prompt routing (beberapa putaran revisi setelah melihat
hasil eval), desain golden set, dan seluruh siklus ukur-perbaiki-ukur.

Yang tidak saya klaim: sebagian besar detail implementasi datang dari AI. Yang
saya klaim: pilihan mana yang dipakai, mana yang ditolak, dan alasannya —
termasuk menolak `k=1` yang tampak menang di atas kertas.

---

## 6. Yang saya tahu masih kurang

- **Precision@k hanya 42%.** Dari 5 chunk yang dikirim, biasanya 2 yang relevan.
  `k=5` dipertahankan demi pertanyaan perbandingan; `k=3` hemat 9% dan lulus
  17/18. Saya pilih kebenaran, tapi ini pemborosan yang saya sadari.
- **Riwayat dikirim mentah 4 pesan**, belum diringkas. Di percakapan panjang ini
  akan boros. Angka 4 dipilih tanpa pengukuran.
- **Ambang dikalibrasi dari 18 pertanyaan.** Sampel kecil. Query yang ditulis
  manager skornya lebih rendah daripada query yang saya tulis manual, sehingga
  ambang 0,49 yang terlihat aman di probe justru merusak sistem — pita amannya
  lebih sempit dari yang terlihat.
- **Pencarian murni vektor.** Identifier eksak (nama paket, pola tag `rel-*`)
  bisa meleset. Di 38 chunk belum jadi masalah; di korpus besar, hybrid search
  yang pertama saya tambahkan.
- **Tidak ada retry.** Kalau manager salah menormalkan pertanyaan, retrieval ikut
  salah dan tidak ada mekanisme perbaikan.
- **Kualitas bahasa jawaban tidak diukur**, hanya kebenaran faktanya. Assertion
  substring memastikan angkanya benar, bukan bahwa kalimatnya enak dibaca.
- **Perbandingan korpus Inggris vs Indonesia tidak jadi diukur.** Jalurnya sudah
  disiapkan (`docs/en/`, `CORPUS_LANG`), tapi waktu habis di masalah retrieval.
  Angka "Indonesia ~15% lebih boros" di catatan ini adalah perkiraan, bukan hasil
  pengukuran.
