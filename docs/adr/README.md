# Architecture Decision Records

Keputusan yang sudah diambil, dan mengapa. Kode boleh berubah; kalau sebuah keputusan
diubah, ADR-nya di-*superseded* oleh yang baru — bukan diedit diam-diam.

| ADR | Judul | Status | Tanggal |
|-----|-------|--------|---------|
| [0001](0001-servo-empat-tingkat.md) | Servo koreksi θ 4 tingkat, bukan servo bebas | accepted | 2026-11-15 |
| [0002](0002-ramp-tempo-per-bar.md) | Ramp tempo dikirim sebagai frame `tempo` biasa, satu langkah per bar | accepted | 2026-11-15 |
| [0003](0003-adopt-index-ekor-antrean.md) | `adoptIndex` melaporkan beat yang tertelan di jahitan | accepted | 2026-11-15 |
| [0004](0004-serah-terima-grid-pada-anchor.md) | Grid baru diambil alih pada anchor-nya, bukan saat frame mendarat | accepted | 2026-11-15 |
| [0005](0005-kunci-pemimpin-dari-create.md) | Otoritas pemimpin = kunci `lk` yang dicetak terpisah di `/create`; rebut hanya lewat tombol | accepted | 2026-11-17 |
| [0006](0006-kursi-dari-socket-hidup.md) | `N HP` dihitung dari socket hidup, bukan riwayat tabel `member` | accepted | 2026-11-17 |
| [0007](0007-attachment-identitas-socket.md) | Identitas `ws → {sid, did}` di attachment Hibernation; `webSocketError` diam karena `webSocketClose` terbukti menyusul | accepted | 2026-11-17 |
