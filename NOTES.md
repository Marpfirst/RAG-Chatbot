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
| + embed pertanyaan asli + query manager | 619 | 18/18 | |
| + konsistensi antar-giliran | 666 | 18/18 | lihat §4 |
| + batas di luar domain diperketat | **+70/pertanyaan** | **24/24** | golden set 18 → 24 soal, lihat §4 |

**2.654 → 666 token, turun 75%**, dengan 18/18 lulus pada golden set 18 soal.

Setelah itu golden set diperluas jadi 24 soal dan batas "di luar domain"
diperketat (§4). Angka totalnya jadi 675, tapi **itu bukan perbandingan yang
sah** — komposisi soalnya berubah. Yang sebanding adalah kenaikan per kategori:
**+70 token per pertanyaan**, sekitar 10%. Itu harga yang dibayar untuk menutup
lima kelas pertanyaan yang sebelumnya lolos.

Per kategori:

| Kategori | Naif | Final | Turun |
|---|---|---|---|
| Pertanyaan umum | 2.640 | 440 | 83% |
| Butuh dokumen | 2.519 | 822 | 67% |
| Perbandingan dua section | 2.636 | 810 | 69% |
| Pertanyaan susulan | 2.575 | 906 | 65% |
| Tidak ada di dokumen | 2.554 | 647 | 75% |
| Permintaan di luar domain | 3.296 | 418 | 87% |

Yang paling berdampak, berurutan: **top-k retrieval** (mengirim ~250 token
konteks, bukan 3.034), **pagar `max_tokens` plus penolakan di luar domain**
(kasus terburuk turun dari 3.885 jadi ~370 token), lalu **memadatkan peta
dokumen**.

Perhatikan arah tabelnya: angka turun sampai 456, lalu **naik lagi** ke 666.
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

`eval/golden.jsonl` — 24 pertanyaan, enam kategori: umum, butuh dokumen,
perbandingan dua section, tidak ada di dokumen, permintaan di luar domain, dan
pertanyaan susulan yang bergantung pada riwayat. Beberapa berbahasa Inggris.

Tujuh dari 24 menguji batas "di luar domain", termasuk yang berdekatan dan
mudah tertukar: pemrograman, matematika, terjemahan, pengetahuan umum. Enam di
antaranya ditambahkan setelah Python lolos (§4) — wilayah yang tidak diuji
adalah wilayah yang bocor.

Pengukurannya tiga lapis, supaya regresi bisa dilacak ke lapisan penyebabnya:

- **routing** — rute yang diambil sesuai harapan?
- **recall@k / precision@k** — chunk yang benar terambil?
- **assertion jawaban** — fakta kunci muncul di teks?

Penilaian pakai substring, bukan LLM judge. Membakar token untuk menilai tugas
hemat token itu kontradiktif, dan semua fakta di korpus berupa angka atau nama.

Ditambah dua assertion yang tidak berbasis kata: `max_output_tokens` untuk
memastikan permintaan di luar domain ditolak singkat, dan `min_output_tokens`
untuk memastikan pertanyaan yang seharusnya dijawab benar-benar dapat jawaban —
bukan penolakan, dan bukan kutipan instruksi sistem (§4).

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

**Titik buta kedua: semua soal diuji satu-satu.** Golden set mengirim tiap
pertanyaan dalam percakapan baru, jadi tidak pernah menguji apa yang terjadi
setelah beberapa giliran. Bug yang paling parah di proyek ini justru hanya
muncul di sana, dan ditemukan lewat pemakaian manual, bukan oleh eval (§4).
`scripts/repro.ts` sekarang memutar ulang satu percakapan delapan giliran dan
memeriksa jawabannya tetap konsisten.

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

### Manager meniru penolakannya sendiri

Ditemukan saat mencoba aplikasinya dengan tangan, bukan oleh eval. Pertanyaan
yang sama — "what is sla" — dijawab empat cara berbeda dalam satu percakapan:
dijelaskan dengan benar, lalu ditolak sebagai di luar domain, lalu dilempar ke
specialist yang menjawab "tidak ada di dokumen".

Sebabnya: manager melihat empat pesan terakhir, **termasuk jawabannya sendiri**.
Begitu dia menolak sekali, penolakan itu masuk riwayat dan berfungsi sebagai
contoh yang dia tiru di giliran berikutnya. Percakapan jadi makin sempit seiring
berjalan.

Ada dua sebab tambahan yang menumpuk di atasnya: tingkat "umum tapi relevan"
tidak punya contoh sama sekali di prompt, dan aturan pemecah seri saya —
*"kalau ragu antara 1 dan 2, pilih 1"* — terlalu luas, mendorong pertanyaan yang
jelas bukan soal Sigap ke retrieval.

Perbaikannya: beri contoh konkret untuk tingkat 2, persempit aturan pemecah seri
jadi "ragu apakah ini tentang **Sigap**", dan tambahkan satu kalimat bahwa
giliran sebelumnya adalah konteks, bukan contoh yang harus ditiru. Versi pertama
perbaikan ini memperbaiki perilakunya tapi menambah 147 token per pertanyaan
(+24%); setelah dipadatkan tanpa mengubah perilaku, biayanya turun jadi 47 token.

Pelajarannya bukan soal prompt. Eval yang menguji pertanyaan satu per satu tidak
akan pernah menemukan bug ini, karena bug-nya hanya ada di percakapan.

### Batas "di luar domain" bocor, dan perbaikannya membuka bug lain

"What is Python?" dijawab manager. Ditemukan Alvin dengan mencoba sendiri,
bukan oleh eval — sama seperti temuan sebelumnya.

Dua sebab. Pertama, tier 2 berbunyi "Support/SaaS general knowledge", dan kata
"SaaS" membuat model membaca apa pun yang berbau perangkat lunak sebagai
relevan. Kedua — dan ini yang penting — **perbaikan bug konsistensi di atas yang
membukanya.** Baris "kalau ragu, pilih 2 daripada 3" ditambahkan untuk
menghentikan manager menolak "what is sla"; efek sampingnya, setiap kasus batas
jadi condong ke arah menjawab.

Dua bug itu menarik ke arah berlawanan. Memperketat satu sisi membangkitkan
sisi lain, dan itu terjadi tiga kali berturut-turut:

1. Tier 3 diperketat + pemecah seri dibalik → Python tertutup, tapi
   "what is a helpdesk ticket" dan "beda SLA dan SLO" ikut ditolak
2. Pemecah seri ditulis ulang sebagai pertanyaan ("ask: is this about doing
   support work?") → model **mengucapkan kalimat itu ke user** sebagai jawaban
3. Pemecah seri dibuang, diganti contoh konkret di tier 2 → hampir benar, tapi
   "what is sla" huruf kecil masih ditolak tepat setelah versi kapitalnya
   dijawab

Yang akhirnya menutupnya: **menulis contoh jangkar dalam bentuk yang persis
gagal.** Contoh rapi `"What is an SLA?"` tidak menular ke `"what is sla"`.
Setelah jangkarnya ditulis huruf kecil, delapan giliran berturut-turut konsisten.

Biayanya +70 token per pertanyaan (~10%), menutup lima kelas yang sebelumnya
lolos: pemrograman, matematika, terjemahan, pengetahuan umum, dan penulisan
kreatif.

### Alat ukur meloloskan jawaban yang jelas salah — dua kali

Lebih mengganggu daripada bug-nya sendiri.

Saat tier 2 ikut tertolak, eval tetap **lulus** kasus itu, karena assertion-nya
hanya memeriksa rute — dan penolakan juga dijawab manager. Saya tambahkan
`must_not_include` untuk kata penolakan; eval lulus lagi, kali ini pada jawaban
yang isinya kalimat instruksi saya sendiri, karena kalimat itu tidak memuat kata
penolakan mana pun.

Assertion berbasis kata kunci hanya menjaga bentuk kegagalan yang sudah
terbayangkan. Yang akhirnya menangkap keduanya jauh lebih bodoh: **panjang
output minimum**. Penolakan pendek, kutipan instruksi pendek, jawaban sungguhan
tidak. `min_output_tokens: 35` pada soal tier 2 menangkap dua-duanya sekaligus.

Pelajarannya sama seperti `k=1` di §3: setiap kali eval saya "lulus" padahal
sistemnya rusak, penyebabnya assertion yang mengukur hal yang mudah diukur,
bukan hal yang sebenarnya penting.

### Pertanyaan perbandingan

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
- **Riwayat masih bisa menggeser perilaku.** Instruksi "giliran sebelumnya
  adalah konteks, bukan contoh" memperbaiki kasus yang saya temukan, tapi itu
  bujukan terhadap model, bukan jaminan. Percakapan yang lebih panjang atau
  lebih aneh dari delapan giliran di `scripts/repro.ts` belum diuji.
- **Kualitas bahasa jawaban tidak diukur**, hanya kebenaran faktanya. Assertion
  substring memastikan angkanya benar, bukan bahwa kalimatnya enak dibaca.
- **Perbandingan korpus Inggris vs Indonesia tidak jadi diukur.** Jalurnya sudah
  disiapkan (`docs/en/`, `CORPUS_LANG`), tapi waktu habis di masalah retrieval.
  Angka "Indonesia ~15% lebih boros" di catatan ini adalah perkiraan, bukan hasil
  pengukuran.
