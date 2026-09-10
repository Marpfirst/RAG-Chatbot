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

Pertanyaan yang dijawab manager adalah **satu pertanyaan, bukan tiga aturan**:
apakah jawaban yang benar butuh fakta yang hanya ada di dokumen Sigap?

| Langkah | Kriteria | Contoh | Rute |
|---|---|---|---|
| STEP 1 | butuh fakta spesifik Sigap | "Berapa harga paket Tumbuh?" | `search_docs` → specialist |
| STEP 2 | tidak butuh, dan topiknya masih di domain asisten ini | "Apa itu SLA?" | manager jawab, maks 3 kalimat |
| STEP 3 | tidak butuh, dan topiknya di luar domain | "Tulis esai 2000 kata" | manager tolak, satu kalimat |

Yang **bukan** kriteria: panjang pertanyaan, huruf besar-kecilnya, dan panjang
jawaban yang akan keluar. Ketiganya sempat dipakai sebagai proksi dan ketiganya
salah — pesan dua kata huruf kecil bisa butuh retrieval, dan pertanyaan yang
jawabannya panjang bisa tetap di dalam domain. Aturannya sekarang ditulis
eksplisit di prompt supaya tidak diam-diam dipakai lagi.

Yang juga bukan kriteria: **daftar kategori terlarang**. Versi sebelumnya
menyebutkan "pemrograman, teknologi umum, matematika, terjemahan, tulisan
kreatif" satu per satu, dan gagal persis seperti daftar selalu gagal — "Apa itu
API?", "Apa itu webhook?" dan "Apa itu reimbursement?" masing-masing berjarak
satu langkah dari daftar yang diizinkan, jadi ketiganya ditolak mentah-mentah.
Yang dipakai sekarang adalah relevansi domain, bukan enumerasi.

Tingkat ketiga sengaja ada. "Pertanyaan umum" yang tak berbatas adalah lubang
token: tanpa tingkat itu, permintaan esai dijawab patuh dan badge menampilkan
ribuan token.

Bahan keputusannya adalah **peta dokumen** di system prompt manager — nama
dokumen plus beberapa judul section. Saat ragu, manager condong ke specialist.
Pertanyaan yang butuh fakta Sigap **selalu** lewat retrieval, bahkan ketika model
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
| golden set diperluas (24 → 34 soal) | 789 | 31/34 | 3 topik dalam domain ternyata ditolak |
| + routing berbasis cakupan, bukan daftar | **842** | **34/34** | +53 token, lihat §4 |

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

Yang paling berdampak, berurutan: **top-k retrieval** (mengirim ~230 token
konteks, bukan seluruh korpus), **pagar `max_tokens` plus penolakan di luar
domain** (kasus terburuk turun dari 3.885 jadi ~370 token), lalu **memadatkan
peta dokumen**.

> **Catatan tokenizer.** Angka "seluruh korpus" di tabel ini, dan semua angka
> per-chunk yang pernah dikutip dari kolom `chunks.token_count`, dihitung dengan
> **`cl100k_base`** — karena kolom itu diisi dari `usage.prompt_tokens` API
> embedding (`text-embedding-3-small`), bukan dari model chat. Dengan
> `o200k_base`, tokenizer `gpt-4o-mini`, korpus yang sama berukuran **2.480
> token**, bukan 3.056.
>
> Angka baseline naif dan seluruh kolom "avg token" di dokumen ini **tidak**
> terpengaruh: semuanya dibaca dari `usage` API chat, jadi sudah `o200k`.
> Yang terpengaruh hanya angka turunan yang mengutip `token_count`. Atribusi
> token per-komponen di §7 direkonstruksi terpisah dengan `o200k_base`.

Perhatikan arah tabelnya: angka turun sampai 456, lalu **naik lagi** ke 666,
lalu ke 842. Kenaikan itu disengaja — setiap kenaikan membeli satu perbaikan
kebenaran yang terukur. Konfigurasi termurah bukan yang terbaik.

Dua baris terakhir perlu dibaca hati-hati. Golden set diperluas dulu dari 24 ke
34 soal **tanpa mengubah kode sama sekali**, supaya angka "sebelum" dan
"sesudah" diukur pada kumpulan soal yang sama. Pada 34 soal itu, sistem lama
mendapat 31/34 dengan 789 token; sistem baru mendapat 34/34 dengan 842 token.
Jadi harga jujurnya adalah **+53 token per pertanyaan (+6,7%) untuk tiga kelas
pertanyaan dalam domain yang sebelumnya ditolak.**

Percobaan menurunkan token setelah itu, semuanya diukur satu variabel per
langkah:

| Yang dicoba | avg token | Lulus | Putusan |
|---|---|---|---|
| daftar contoh domain dibuang dari prompt | 853 → **840** | 34/34 | **dipakai** |
| aturan "software bukan berarti dalam cakupan" dibuang | 853 → **840** | 34/34 | **dipakai** |
| kalimat kedua aturan anti-deflection dibuang | 871 | 32/34 | ditolak, 25 token untuk 2 kasus |
| dua klausa STEP 1 yang tumpang tindih digabung | 831 | 33/34 | ditolak, 8 token untuk 1 kasus |
| `MATCH_COUNT` 5 → 4 | 823 | 33/34 | ditolak, pertanyaan susulan patah |
| `MATCH_COUNT` 5 → 3 | 803 | 33/34 | ditolak, pertanyaan susulan patah |
| `HISTORY_TURNS` 4 → 2 | 840 | 34/34 | ditolak, lihat di bawah |

`HISTORY_TURNS=2` lulus penuh dan memangkas percakapan panjang cukup banyak
(giliran ke-8 di `scripts/repro.ts`: 926 → 655 token). Tetap ditolak karena
angka itu dihitung dalam **pesan**, bukan pertukaran: 2 berarti satu tanya-jawab,
tanpa sisa sama sekali untuk pertanyaan susulan bertingkat. Di golden set
hematnya cuma 2 token, karena hampir semua soalnya satu giliran.

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

`eval/golden.jsonl` — 34 pertanyaan, tujuh kategori: umum, batas cakupan, butuh
dokumen, perbandingan dua section, tidak ada di dokumen, permintaan di luar
domain, dan pertanyaan susulan yang bergantung pada riwayat. Beberapa berbahasa
Inggris.

Tujuh dari 34 menguji batas "di luar domain", termasuk yang berdekatan dan
mudah tertukar: pemrograman, matematika, terjemahan, pengetahuan umum. Enam di
antaranya ditambahkan setelah Python lolos (§4) — wilayah yang tidak diuji
adalah wilayah yang bocor.

Sepuluh soal terakhir (`b01`-`b10`) adalah kategori `boundary`, ditambahkan
untuk menguji garis "umum tapi relevan" lawan "di luar domain" secara langsung:
istilah teknis (`Apa itu API?`, `Apa itu webhook?`), istilah HR (`Apa itu
reimbursement?`), praktik helpdesk (`Bagaimana cara membuat knowledge base yang
baik?`), permintaan pemrograman (`Buatkan game Snake dengan Python.`), kosakata
pembaca yang tidak dipakai dokumen (`Berapa batas attachment Sigap?`, `Hari apa
karyawan Sigap WFH?`), huruf besar-kecil yang aneh (`WHAT IS SLA`, `wHaT iS
sLa`), dan pertanyaan susulan berbentuk elipsis (`Kalau yang sakit?`).
Kategorinya dipisah supaya perubahan di garis itu terlihat sendiri, tidak
tenggelam dirata-rata dengan sisanya.

Contoh domain yang ditulis di prompt **sengaja bukan** kata-kata yang diuji di
sini. Kalau `API` dan `webhook` ditulis di prompt, `b01` dan `b06` berhenti
menguji apa pun.

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

### Pertanyaan dua bagian, dan refleks model yang mengalahkan aturan

Diuji dengan satu pertanyaan campuran: *"apakah karyawan di sigap memiliki gaji
tinggi? apakah mereka bekerja tiap hari?"* Bagian gaji tidak ada di korpus,
bagian jadwal kerja ada.

Hasil awal: manager **menolak seluruh pesan tanpa mencari sama sekali**, 0 chunk.
Padahal aturan tier 1 berbunyi "pesan apa pun tentang Sigap wajib mencari".

Isolasi menunjukkan penyebabnya bukan struktur dua bagiannya. Membalik urutan
klausa tidak mengubah apa-apa, dan *"berapa gaji karyawan di sigap?"* sendirian
juga ditolak tanpa mencari — sementara *"apakah karyawan sigap bekerja tiap
hari?"* sendirian dijawab benar dengan 5 chunk.

Jadi penyebabnya satu kata: **gaji**. Model punya refleks bawaan menolak
pertanyaan kompensasi, dan refleks itu mengalahkan aturan routing. Menguatkan
kalimat "cari dulu, dokumen yang menentukan apa yang tidak ada" tidak menolong;
yang menolong adalah **menyebut pay dan benefits secara eksplisit sebagai topik
tier 1**. Setelah itu pertanyaannya dicari, dan jawabannya benar: jadwal kerja
dijelaskan, gaji dinyatakan tidak ada di dokumen.

Pelajarannya: aturan di prompt bersaing dengan kecenderungan bawaan model, dan
kadang kalah. Yang menang bukan aturan yang lebih tegas, melainkan menempatkan
topiknya di dalam kategori yang sudah dipercaya model.

Ongkosnya +35 token per pertanyaan.

### Keterbatasan yang tidak diperbaiki: campuran umum + dokumen

*"apa itu SLA? dan berapa harga paket Tumbuh?"* dijawab separuh — harganya
benar, definisi SLA-nya dijawab "tidak ada di dokumen".

Ini konsekuensi langsung dari pemisahan dua agent, bukan bug prompt. Begitu
manager mendelegasikan, yang menjawab adalah specialist, dan specialist
diinstruksikan menjawab **hanya** dari konteks. Bagian yang butuh pengetahuan
umum tidak punya siapa pun yang menjawabnya.

Memperbaikinya berarti memilih salah satu:

- izinkan specialist menjawab dari pengetahuannya sendiri — merusak jaminan
  bahwa jawabannya berdasar dokumen, yang justru sifat inti sistem ini
- manager menjawab bagian umum lalu mendelegasikan sisanya — butuh panggilan
  ketiga, di tugas yang menilai token

Keduanya menukar sesuatu yang lebih berharga daripada yang didapat, jadi
dibiarkan.

### Query pencarian yang terlalu pendek, dan biaya mengulang aturan

"kapan WFH?" dirutekan benar ke specialist lalu dijawab "tidak ada di dokumen",
padahal kebijakannya ada. Retrieval tidak bersalah: manager menulis query
pencarian **"WFH"** — satu kata. Yang di-embed jadi `"kapan WFH? WFH"`, skornya
0,370, di bawah ambang 0,40.

Query yang lebih kaya untuk chunk yang sama, `"hari kerja dari rumah WFH Sigap"`,
mendapat **0,787**. Selisihnya bukan soal ambang atau `k`, melainkan dua
karakter melawan sebuah frasa.

Perbaikannya menyuruh manager menulis query sebagai frasa benda utuh —
memanjangkan singkatan dan memakai kata yang dipakai dokumen — dengan satu
contoh buruk dan satu contoh baik. Setelah itu skornya 0,638.

Korpusnya juga diperbaiki: section "Kerja dari Rumah" kini menyebut "(WFH, work
from home)", karena itu kata yang dipakai penanya. Pola yang sama seperti SLA.

**Pengulangan aturan itu ada harganya, dan sempat saya bayar.** Untuk kasus
"apa itu cuti?" — topik yang jelas ada di dokumen tapi ditanyakan secara
definisi — saya menambahkan tiga aturan berbeda yang isinya sama. Memadatkannya
jadi satu kalimat membuat kasus itu gagal lagi, jadi pengulangannya memang
bekerja: model menimbang instruksi yang ditemuinya tiga kali lebih berat
daripada sekali.

Tapi setelah diukur enam kali, hasilnya cuma **2 dari 6 benar**, dengan ongkos
~115 token di **setiap** pertanyaan. Sepertiga keberhasilan pada satu kasus
tidak sebanding, jadi ketiga aturan itu dilepas dan disisakan satu.

"apa itu cuti?" karena itu masih sering ditolak. Bentuk "apa itu X" di mana X
adalah topik yang terdokumentasi adalah celah yang belum tertutup — sementara
"berapa lama cuti tahunan?" dan "kapan WFH?" dijawab benar dan konsisten.

### Batas antara "umum" dan "di luar domain" tidak punya kebenaran objektif

Ini keterbatasan paling mendasar di proyek ini, dan tidak akan hilang dengan
prompt yang lebih pintar.

Batas tier 1 tajam dan bisa dipertahankan: **butuh fakta tentang Sigap atau
tidak.** Ada jawaban benarnya, dan bisa diperiksa.

Batas tier 2 lawan tier 3 tidak begitu. "Umum" itu tak berbatas, dan "relevan
dengan pekerjaan dukungan pelanggan" adalah penilaian, bukan aturan. Buktinya
ada di pengujian sendiri:

Spesifikasi tugasnya sendiri tidak mendefinisikan batas ini. Yang tertulis
hanya "pertanyaan umum bisa dijawab manager" — dan "umum" tidak dijelaskan.
Jadi setiap angka di bawah ini diukur terhadap **penafsiran saya**, bukan
terhadap kunci jawaban yang diberikan.

Versi lama memakai daftar topik yang diizinkan. Hasilnya, diukur:

| Pertanyaan | Versi lama | Versi sekarang |
|---|---|---|
| Apa itu SLA? | dijawab | dijawab |
| What is a helpdesk ticket? | dijawab | dijawab |
| Bagaimana membuat knowledge base yang baik? | **ditolak** | dijawab |
| Apa itu API? | **ditolak** | dijawab |
| Apa itu webhook? | **ditolak** | dijawab |
| Apa itu reimbursement? | **ditolak** | dijawab |
| Apa itu Zendesk? | ditolak | bisa diperdebatkan |
| What is Python? | ditolak | ditolak |

Empat baris yang tebal itu semuanya di dalam domain menurut penafsiran mana
pun, dan semuanya ditolak — bukan karena modelnya salah menilai, tapi karena
masing-masing berjarak satu langkah dari daftar yang ditulis di prompt.
Itulah alasan daftarnya dibuang dan diganti relevansi domain.

Yang tidak hilang: baris "Apa itu Zendesk?" tetap tidak punya jawaban yang
disepakati. Zendesk itu pesaing di domain yang sama — layak dijelaskan singkat,
atau justru bukan urusan asisten internal? Keduanya bisa dibela. Begitu juga
garis antara "Apa itu API?" (dijawab) dan "What is Python?" (ditolak): keduanya
istilah teknis, dan yang memisahkan hanya penilaian bahwa satu dipakai dalam
mengoperasikan produk SaaS dan satu lagi tidak.

Yang bisa dilakukan hanyalah **mengukur di mana batasnya jatuh** dan menerima
bahwa sebagian kasus akan salah. Tidak ada eval yang bisa memberi nilai penuh
di sini, karena tidak ada kunci jawaban yang benar — nilai 34/34 berarti sistem
ini konsisten dengan penafsiran saya, bukan bahwa penafsiran saya benar.

**Dua kasus yang tidak bisa saya selesaikan dengan aturan.**

Yang pertama: mengulang pertanyaan yang sama dalam bahasa berbeda **tepat
setelah** dijawab kadang membuat manager membalas dengan pernyataan cakupan,
bukan penjelasan. Tiga aturan umum dicoba dan semuanya gagal. Yang berhasil
adalah menuliskan string harfiah `"what is sla"` ke dalam prompt — dan itu saya
**buang**, karena mengistimewakan satu susunan kata tanpa alasan yang bisa
dibela.

Catatan yang penting soal kasus ini: pada kode yang **persis sama**, kasus ini
lolos dua kali dan gagal dua kali dari empat kali jalan. Jadi tidak ada susunan
kata di prompt yang boleh diklaim "memperbaikinya" berdasarkan satu kali hijau.
Tool-calling tidak sepenuhnya deterministik walaupun `temperature: 0`.

Yang kedua, dan ini konsisten: setelah pertanyaan yang sama dijawab pada
giliran **tepat sebelumnya**, manager membacanya sebagai permintaan yang lebih
spesifik dan berbelok ke `search_docs`. Query dua hurufnya tidak melewati ambang
kemiripan, dan pengguna mendapat "tidak ada di dokumen" untuk pertanyaan yang
baru saja dijawab dengan benar. Tiga hal dicoba dan tidak ada yang menggeser:

| Yang dicoba | Hasil |
|---|---|
| aturan "riwayat mengisi yang kosong, bukan mengubah cakupan" | tetap gagal |
| aturan "mengulang bukan tanda jawaban sebelumnya kurang" | tetap gagal, dan merusak kasus pertama |
| `HISTORY_TURNS` 4 → 2 | tetap gagal |

Ini pertukaran yang saya pilih sadar. Versi lama menolak tiga topik dalam
domain — API, webhook, reimbursement — dan **setiap** pengguna yang bertanya
soal itu kena. Versi sekarang salah pada pengulangan keempat pertanyaan yang
identik dalam satu percakapan, yang hampir tidak ada yang melakukannya.

Ketiganya ditandai `KNOWN_LIMITATION` di `scripts/repro.ts`: tetap dijalankan
dan tetap terlihat, tapi tidak dihitung sebagai kegagalan. Kalau suatu saat
lolos, itu justru layak diketahui.

### Dokumen memakai kosakata penulisnya, bukan kosakata penanyanya

Ditemukan dengan menembakkan pertanyaan di sekitar batas, bukan oleh eval.

Fakta yang sama, dua cara bertanya, dua hasil berbeda:

| Pertanyaan | Hasil |
|---|---|
| "SLA di Sigap berapa lama?" | ketemu — P1 15 menit, P2 60 menit |
| "Apakah Sigap punya SLA?" | **"tidak ada di dokumen"** |

Sebabnya sederhana dan tidak ada hubungannya dengan retrieval: **kata "SLA"
tidak pernah muncul di korpus.** Yang tertulis "waktu respons insiden".
Embedding menangkapnya kalau pertanyaannya menyebut durasi, tapi tidak kalau
pertanyaannya menanyakan keberadaan.

Penolakan palsu seperti ini lebih buruk daripada penolakan yang benar: sistem
terlihat tidak tahu sesuatu yang sebenarnya ada di dokumennya sendiri.

Perbaikannya bukan menurunkan ambang atau menambah `k`, melainkan **memperbaiki
dokumennya** — section itu sekarang menyebut istilah SLA. Dokumen sebaiknya
memakai kata yang dipakai penanya, bukan kata yang dipakai penulisnya. Menurunkan
ambang akan menambal gejala ini sambil melemahkan seluruh sistem.

Di pengujian yang sama juga terlihat batas tier 2 hanya menggeneralisasi
sebagian: CSAT dan "first response time" dijawab, tapi "bagaimana membuat
knowledge base yang baik" ditolak — padahal itu inti pekerjaan helpdesk. Yang
dekat dengan contoh berhasil, yang satu langkah lebih jauh jatuh ke tier 3.
Daftar contoh di tier 2 diperlebar supaya langkahnya lebih pendek.

### Alat ukur meloloskan jawaban yang jelas salah — tiga kali

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

Pola yang sama muncul lagi kemudian, dan kali ini di `scripts/repro.ts`: sebuah
elakan yang kebetulan menyebut "Service Level Agreements" sambil mendaftar
cakupan asisten lolos dari pengecekan kata kunci. Ambang panjang output
ditambahkan di sana juga. Assertion berbasis kata kunci punya kelemahan yang
sama di mana pun ia dipakai.

Lalu terjadi untuk ketiga kalinya, dan ambang panjang output-lah yang kali ini
kecolongan. Sepuluh soal batas yang baru diberi `min_output_tokens: 30`, dengan
alasan penolakan itu pendek. Eval melaporkan 33/34. Tapi jawaban sebenarnya
untuk "Apa itu API?" adalah:

> Saya tidak dapat memberikan informasi tentang API. Namun, saya dapat membantu
> dengan topik terkait dukungan seperti praktik helpdesk, tiket, dan metrik
> kepuasan.

Penolakan itu **34 token** — lewat ambang, jadi dihitung lulus. Tiga penolakan
lolos begitu. Angka 30 saya tebak, tidak saya ukur; penolakan yang panjang
sekalimat-dua lebih panjang dari yang saya bayangkan.

Perbaikannya: ambang dinaikkan ke 40 **dan** ditambah `must_not_include` untuk
pembuka penolakan (`saya tidak dapat`, `saya hanya`, `i can't`, `i cannot`).
Skor "sebelum" yang benar setelah dikoreksi bukan 33/34, tapi **31/34** — dan
angka itulah yang dipakai di tabel §2, dihitung ulang terhadap jawaban yang
sudah tersimpan supaya tidak perlu memanggil API lagi.

Pelajarannya sama seperti `k=1` di §3: setiap kali eval saya "lulus" padahal
sistemnya rusak, penyebabnya assertion yang mengukur hal yang mudah diukur,
bukan hal yang sebenarnya penting. Dan yang ketiga ini menambah satu lagi:
**ambang yang ditebak adalah assertion yang mengukur tebakan saya**, bukan
sistemnya.

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

- **Sekitar 175 token jadi bantalan di tiap pertanyaan dokumen.** `k` dipatok 5,
  padahal sebagian besar pertanyaan terjawab oleh satu section — empat chunk
  sisanya jadi bantalan. `k=5` dipertahankan karena pertanyaan perbandingan
  memang butuh dua, dan `k=3` merusak pertanyaan susulan saat diukur. Adaptive
  `k` sudah dicoba di dua ambang dan hasilnya lebih buruk; layak dicoba lagi
  sekarang setelah query retrieval berubah.

  Angka 340 di versi sebelumnya salah, dan salahnya layak disebut: kolom
  `chunks.token_count` diisi dari `usage.prompt_tokens` **API embedding**, jadi
  dihitung dengan `cl100k_base` — tokenizer model embedding, bukan model chat.
  Model chat menagih dengan `o200k_base`, yang di korpus ini sekitar 19% lebih
  hemat. Semua angka per-chunk yang diambil dari kolom itu ikut kelebihan.

  Catatan soal angkanya: harness melaporkan ini sebagai **precision@k 37%**, dan
  angka itu terlihat lebih buruk dari kenyataannya. Kalau satu chunk yang benar
  dan lima yang dikirim, precision **tidak mungkin** melebihi 0,20 — itu
  aritmetika `k` yang dipatok, bukan mutu retrieval. Yang benar-benar layak
  dikejar adalah tokennya, bukan angka precision-nya.
- **Riwayat dikirim mentah 4 pesan**, belum diringkas. Di percakapan panjang ini
  akan boros. Angka 4 sekarang sudah diukur terhadap 2: keduanya lulus 34/34,
  dan 2 lebih murah di percakapan panjang, tapi 2 pesan berarti satu tanya-jawab
  tanpa sisa untuk pertanyaan susulan bertingkat. Yang belum diukur adalah
  meringkas riwayat, bukan memotongnya.
- **Ambang dikalibrasi dari 18 pertanyaan.** Sampel kecil. Query yang ditulis
  manager skornya lebih rendah daripada query yang saya tulis manual, sehingga
  ambang 0,49 yang terlihat aman di probe justru merusak sistem — pita amannya
  lebih sempit dari yang terlihat.
- **Rute bisa bergeser kalau pertanyaan yang sama diulang berkali-kali dalam
  satu percakapan.** Pengulangan keempat "what is sla" berbelok ke retrieval dan
  menjawab "tidak ada di dokumen". Tiga perbaikan dicoba dan tidak ada yang
  menggeser; angkanya di §4.
- **Rate limit berbagi jatah dalam satu alamat.** Dihitung per alamat klien,
  15 per menit. Longgar untuk satu orang, tapi satu kantor di balik NAT berbagi
  angka itu, dan pemanggil terdistribusi sama sekali tidak tertahan. Ini
  membatasi laju, bukan total — batas pengeluaran yang sebenarnya tetap budget
  cap di sisi penyedia.
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

---

## 7. Ke mana 841 token itu sebenarnya pergi

Setelah rute benar 34/34, pertanyaannya berubah: bukan lagi "bisa lebih murah?"
tapi **"murahnya di mana?"**. Atribusi di bawah direkonstruksi dari
`usage_log` untuk satu run penuh (`eval/results/SHIP.json`), dan ke-34 kasusnya
cocok persis dengan angka yang dilaporkan harness. Komponen yang tidak disimpan
terpisah (system prompt, riwayat, konteks) dihitung ulang dengan `o200k_base`.

| Komponen | token/pertanyaan | % |
|---|---:|---:|
| System prompt manager — teks kebijakan | 464,0 | 55,1% |
| Specialist — konteks dokumen | 112,9 | 13,4% |
| System prompt manager — peta dokumen | 94,0 | 11,2% |
| Manager — skema tool + chat template | 49,0 | 5,8% |
| Specialist — preamble tetap | 35,4 | 4,2% |
| Output manager — jawaban (19 kasus) | 33,3 | 4,0% |
| Output specialist | 13,6 | 1,6% |
| Specialist — pertanyaan + rewrite + template | 10,3 | 1,2% |
| Output manager — tool call (15 kasus) | 9,6 | 1,1% |
| Teks pertanyaan | 8,8 | 1,0% |
| Embedding | 8,5 | 1,0% |
| Riwayat percakapan (2 kasus) | 2,0 | 0,2% |

Temuan utamanya satu kalimat: **setiap pertanyaan membayar 616 token sebelum
apa pun terjadi** — 558 system prompt, 49 template dan skema tool, ~9
pertanyaannya sendiri. Itu 73% dari rata-rata, dan kasus termurah di seluruh
benchmark adalah 645 token.

`cached_tokens` **nol di ke-68 call**. Prompt manager 558 token; ambang cache
otomatis OpenAI 1.024 token. Sistem ini terlalu kecil untuk di-cache.

### Tiga percobaan penghematan, satu variabel per percobaan

Benchmark-nya tidak diubah: 34 soal yang sama, assertion yang sama.

| Percobaan | avg token | Lulus | Putusan |
|---|---:|---:|---|
| Baseline | 841,4 | 34/34 | — |
| 1. `DOCMAP=compact` | 781 | 31/34 | **dibatalkan** |
| 2. Header `[Doc > Section]` dibuang saat generate | **818** | **34/34** | **dipakai** |
| 3a. Kebijakan ditulis ulang padat (349 tok) | 694 | 32/34 | dibatalkan |
| 3b. 3a + rule 1 & 2 diperbaiki | 694 | 31/34 | dibatalkan |
| 3c. Hanya blok Rules dipadatkan (448 tok) | 801 | 32/34 | dibatalkan |

**Percobaan 1 — peta dokumen dipadatkan (94 → 25 token).** Pernah ditolak dulu,
dicoba lagi karena penolakan itu mendahului instruksi query-expansion yang
seharusnya menggantikan fungsi kosakatanya. Ternyata tidak menggantikan. Dua
kerusakan: `g04` ("Gimana cara nulis balasan support yang sopan?") berbelok ke
specialist dan dijawab "tidak ada di dokumen", dan `d06` tetap benar tapi
precision-nya jatuh dari 1,0 ke 0,2 — satu chunk jadi lima, +221 token. Judul
section ternyata bekerja di **dua** tempat sekaligus: sinyal routing, dan
kosakata query. Query-expansion hanya menggantikan yang kedua.

**Percobaan 2 — header dibuang saat generate.** Prefiks `[Doc > Section]` biaya
12,6 token per chunk, 480 token di seluruh korpus, ~51 token per panggilan
specialist. Ia jelas berguna saat **retrieval**: ia ikut di-embed, dan itulah
yang memisahkan tiga section cuti yang nyaris identik di ruang vektor. Saat
**generate**, konteksnya sudah menyempit. Dibuang hanya di `runSpecialist`;
baris chunk, embedding, dan ranking tidak disentuh.

Hasil: 34/34, 841,4 → 818 token. recall@k tetap 100%, precision@k tetap sama,
dan **tidak ada satu pun kasus yang retrieval-nya berubah** — bukti bahwa
perubahannya memang hanya di sisi generate. Kasus yang paling rawan diperiksa
satu per satu: `d02`/`d05`/`b10` tetap memisahkan cuti tahunan dari cuti sakit,
`m02` tetap memisahkan batas lampiran dari batas ekspor, `b04` tetap menjawab
Senin dan Jumat.

**Percobaan 3 — kebijakan manager dipadatkan.** Ini target terbesar: 464 token,
55% dari seluruh benchmark. Tiga variasi dicoba, tidak ada yang lolos.

- **3a**, ditulis ulang jadi 349 token: `a03` menjawab "Python is a high-level,
  interpreted programming language" — frasa "however the question is phrased"
  di aturan istilah menembus pagar domain. Dan `b04` ("Hari apa karyawan Sigap
  WFH?") justru **ditolak**, karena kalimat "This includes topics you believe
  Sigap does not have" ikut terpangkas.
- **3b**, dua kerusakan itu diperbaiki: turun jadi 31/34 dan recall 83% — `d06`
  ikut rusak. Memperbaiki dua tempat membuka yang ketiga.
- **3c**, hanya blok Rules yang dipadatkan: hanya hemat **16 token**, dan
  membayar dua kasus batas (`b02`, `b09`) yang kembali mengelak.

Kesimpulannya bukan "belum ketemu caranya", tapi **prompt ini ada di minimum
lokal**: memangkas 16 token pun sudah berbiaya dua kasus. Blok Rules yang
kelihatan seperti tumpukan tambalan memang tumpukan tambalan — tapi setiap
tambalannya masih menahan sesuatu yang terukur.

Yang tersisa dan tidak dicoba, sengaja: menaikkan prompt di atas 1.024 token
supaya kena cache otomatis. Itu menurunkan **biaya** tapi menaikkan **token**,
dan yang diukur di tugas ini token.
