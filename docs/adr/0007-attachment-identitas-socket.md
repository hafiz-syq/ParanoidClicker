# ADR-0007: identitas `ws → {sid, did}` disimpan di attachment Hibernation, dan `webSocketError` sengaja dibiarkan diam

**Tanggal**: 2026-11-17 (= 2026-11-16T21:37:06.370Z dengan offset `-420`, dari `node -e
"console.log(new Date().toISOString(), new Date().getTimezoneOffset())"` di menit dokumen ini ditulis)
**Status**: accepted
**Kodi yang didokumentasikan**: `a6ea775` (perbaikan) + `297428a` (tes lebih dulu) atas `33c2342`
**Dasar perintah**: perintah checker `2d6f4ca7-3aba-44e4-ab8d-470daf00b560` ronde M3a #2 — TEMUAN 1
(blokir: otoritas pemimpin hilang sesudah DO di-evict, "Ambil kendali" tidak bisa memulihkan) dan
TEMUAN 2 (tidak blokir: `webSocketError` tanpa beres-beres dan tanpa cakupan tes). Tidak ada keputusan
yang terbuka untuk pemilik di ADR ini; keduanya adalah cacat implementasi terhadap kontrak yang sudah
diterima di ADR-0005 dan ADR-0006, dan perbaikannya tidak menyentuh kontrak itu.

## Konteks

`SessionDO.fetch()` menerima sisi server lewat `this.ctx.acceptWebSocket(server)`
(`SessionDO.ts:45`). Itu API Hibernation, dan konsekuensinya tertulis di dokumen vendor (halaman
`Use WebSockets`, "Last updated Oct 30, 2026", saya ambil 2026-11-16T21:37:13.891Z lewat
`https://developers.cloudflare.com/durable-objects/api/websockets/`):

> When a Durable Object receives no events (such as alarms or messages) for a short period, it is
> evicted from memory. During hibernation: WebSocket clients remain connected to the Cloudflare
> network; **In-memory state is reset**; When an event arrives, the Durable Object is re-initialized
> and its `constructor` runs.
>
> To restore state after hibernation, use `serializeAttachment` and `deserializeAttachment` to
> persist data with each WebSocket connection.

M3a menyimpan identitas hasil `hello` di `private readonly peers = new Map<WebSocket, Peer>()` —
persis jenis keadaan yang kalimat pertama hapus. runtime lalu memanggil handler dengan objek
`WebSocket` BARU, jadi `peerOf` tidak menemukan siapa pun: `assertLeader` (`:198`) dan `claim`
(`:209`) menjawab `NOT_LEADER` untuk pemimpin yang `lk`-nya sah. Yang rusak bukan cuma angka: tombol
"Ambil kendali" (`ClickRoom.tsx:315-318` → `live.ts:151`) adalah satu-satunya jalan pulih yang
dijanjikan `live.ts:146-150`, dan ia jadi jalur buntu sampai orang itu me-reload halaman.

## Keputusan

Satu tempat untuk fakta `socket ini adalah {sid, did}`: **attachment socket**, ditulis di `hello`
(`remember()`, `SessionDO.ts:100-102`) dan dibaca di setiap keputusan otoritas (`peerOf()`,
`:92-98`). Map instance dihapus beserta `peers.delete` di `webSocketClose` — bukan dipertahankan
sebagai cache, karena dua tempat untuk satu fakta adalah sumber cacat ini.

`webSocketError` (`SessionDO.ts:339-342`) **tidak** saya tambahi beres-beres atau siaran. Itu bukan
kemalasan: runtaiannya diukur, dan ternyata `webSocketClose` — yang sudah menyiarkan `state` dengan
kursi yang turun (ADR-0006) — memang menyusul. Menambah siaran di `webSocketError` menghasilkan dua
frame identik untuk satu kesalahan.

Kontrak tidak berubah sedikit pun: `proto` tetap 2, isi frame `state` tetap `bpm`/`anchorMs`/
`running`/`members`, `src/shared/limits.ts` tidak disentuh, dan `seatCount()` tetap memfilter
`readyState === WebSocket.OPEN` (dokumen yang sama mengizinkan `getWebSockets()` mengembalikan socket
yang belum mati, jadi filter itu memang benar dan tidak boleh dilonggarkan).

## Alternatif yang dipertimbangkan

1. **`did` di tabel SQLite, keyed by socket.** Terlambat secara fisik: tidak ada id socket yang
   bertahan lintas hibernasi untuk dijadikan kunci, jadi tabel harus keyed oleh sesuatu yang dikirim
   klien di tiap frame — itu perubahan kontrak (frame perintah harus membawa identitas), dan justru
   membuka kembali lubang yang ditutup M3a: `did` dari frame bisa dikarang siapa pun. **Ditolak.**
2. **Map tetap ada, tapi `tempo`/`start`/`stop` membawa `lk` dan diverifikasi ulang tiap perintah.**
   Menambal tanpa menyatakan kebenaran; menambahkan satu derivasi HMAC per frame ke jalur yang
   dipakai sebelas HP, dan tetap merupakan perubahan kontrak (`lk` di frame perintah). **Ditolak.**
3. **Klien mengirim `hello` ulang ketika menduga DO bangun.** Klien tidak punya jalan mengamati
   kebangunan DO, dan `hello` ulang yang tidak perlu mengirim dua belas frame ke ruangan yang sedang
   menghitung beat. **Ditolak.**
4. **Attachment (`serializeAttachment`/`deserializeAttachment`)** — jawaban resmi vendor untuk
   keadaan per-koneksi, tidak menambah frame, tidak menambah baris SQLite, dan ikut hilang ketika
   koneksi mati, yang justru artinya sama dengan "kursi lepas". **Dipilih.**

## Konsekuensi

**Jadi lebih mudah:** satu sumber kebenaran per socket; `claim` dan `assertLeader` tidak bisa lagi
berbeda pendapat; tes evict (`eviction.spec.ts`) sekarang gagal kalau seseorang memindahkan
identitas kembali ke memori, tanpa perlu tes yang membaca isi field.

**Jadi lebih sulit / harus diterima:** dokumen vendor membatasi attachment (`Maximum serialized size
is 16,384 bytes`, dan *"Modifications to `value` after calling this method are not retained unless you
call it again"*), jadi attachment kita tetap kecil (`{sid, did}` ≈ 40 byte) dan **ditulis ulang di
setiap `hello`**, bukan sekali lalu dipercaya. Kalau nanti ada keadaan per-koneksi yang lebih besar,
jalur resminya adalah Storage API + menyimpan kuncinya di attachment — itu keputusan untuk milestone
berikutnya, bukan yang ini.

**Berubah secara perilaku, dan itu harus disebut, bukan diselipkan:** `baru` di `hello`
(`SessionDO.ts:128`) sekarang dibaca dari attachment. Reconnect pada socket yang sama sesudah DO
bangun tidak lagi dihitung hello pertama, jadi ruangan tidak menerima `state` ekstra untuk socket yang
sudah dikenal. Sebelum perbaikan, Map yang terhapus membuat setiap hello pasca-evict tampak baru.
Ini searah dengan janji "dua belas HP yang reload serentak tidak boleh mengirim dua belas frame", dan
tidak ada assertion yang menuntut sebaliknya — tapi ia adalah perbedaan yang bisa dilihat dari kawat,
jadi dicatat di README bagian "Ronde M3a #2".

**Risiko yang saya lihat:** `peerOf()` dipanggil dengan penjaga `typeof ws.deserializeAttachment ===
'function'`, karena `fakeSocket` di `session.spec.ts` hanya meniru kirim/close. Penjaga itu membuat
socket tanpa attachment dijawab "belum dikenal" (`NOT_LEADER`), bukan melempar `TypeError` — aman ke
arah fail-closed, tapi ia juga berarti harness tes bisa menyembunyikan perbedaan antara runtime asli
dan palsu. Yang menutupinya bukan penjaga ini, tapi `eviction.spec.ts` yang berjalan di workerd asli.

## Catatan vendor yang saya temukan dan TIDAK saya ubah

Dokumen yang sama menulis, di contoh `webSocketClose`: *"With `web_socket_auto_reply_to_close`
(compat date >= 2026-04-07), the runtime auto-replies to Close frames. Calling `close()` is safe but
no longer required."* Proyek ini memakai `compatibility_date: "2026-11-01"` (`wrangler.jsonc:5`), jadi
kemungkinan besar runtime sudah membalas frame close sendiri dan `ws.close(legal ? code : 1000, …)` di
`SessionDO.ts:331` sudah tidak diperlukan lagi. **Saya tidak mengubahnya**, karena tidak ada satu pun
ukur di ronde ini yang membuktikan apa yang berubah — normalisasi `code` di baris itu masih punya
pekerjaannya sendiri (klien boleh mengirim 1005/1006/1015 dan `ws.close()` menolak ketiganya dengan
`InvalidAccessError`), dan itu masih tes yang ada. Kalau checker mau ini dibuka sebagai pekerjaan
tersendiri, itu keputusan dia/pemilik — [TANYA], saya berhenti di teks.

## Test

- `src/worker/eviction.spec.ts` (4 tes, lahir MERAH di `297428a`): **A** pemimpin → evict → `tempo`
  diterima dan `state` disiarkan; **B** pemimpin → evict → `claim` ber-`lk` menyiarkan `state`;
  **C** kontrol positif — `hello` ulang sesudah evict memulihkan kendali dan `members` tetap 2;
  **D** pagar fail-closed — pengikut tanpa `lk` tetap `NOT_LEADER` di `tempo` maupun `claim`, dan
  `bpm` 180 tidak pernah disiarkan. MERAH yang difoto sebelum kode: **2 failed | 2 passed (4)**,
  4,07 s, 2026-11-16T21:11:12Z. Hijau sesudah `a6ea775`: **4 passed (4)**.
- `src/worker/session.spec.ts:610` — `webSocketError menurunkan kursi karena webSocketClose menyusul,
  bukan karena diam`: memanggil `instance.webSocketError(target, …)` dari dalam `runInDurableObject`
  dan menuntut frame `state` dengan `members: 1` mendarat di HP yang masih masuk. Socket korban
  dipilih lewat attachment, bukan `sockets[0]`, karena urutan `getWebSockets()` tidak dijamin.
- Probe sementara (sengaja tidak di-commit — yang di-commit adalah tes di atas) memproduksi bukti
  rantai: `dipanggil:["webSocketClose"]`, `sesudahJumlah:1`, `sesudahOpen:1`,
  `readyStateSoketYangError:3`, dan `state members:1` di sisi HP yang masih di dalam. Output utuhnya
  ada di README bagian "TEMUAN 2 ronde kedua".
