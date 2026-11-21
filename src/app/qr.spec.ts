import { expect, it } from 'vitest';
import jsQR from 'jsqr';
import { qrMatrix } from './qr';

// QR adalah satu-satunya jalur join yang tidak butuh menyalin tautan 70+ karakter. Encoder
// app (`qrMatrix`, dibungkus dari `uqr`) dan decoder yang dipakai kamera (`jsqr`) harus
// sepakat tentang byte yang sama — kalau tidak, layar pemimpin bisa menampilkan kotak yang
// cantik dan tidak terbaca. Tes ini sengaja memakai fungsi yang SAMA dengan `JoinQr`, bukan
// memanggil pustaka encoder dengan pengaturan sendiri.
// Yang diuji di sini: matriks dari encoder, digambar sebagai RGBA, dibaca kembali oleh decoder
// yang sama dengan yang dipakai kamera. Bukan kamera, bukan lensa, bukan layar HP.

function renderModules(url: string, skala = 4, quiet = 4): { data: Uint8ClampedArray; width: number } {
  const { size, modules } = qrMatrix(url);
  const width = (size + quiet * 2) * skala;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y]?.[x]) continue;
      for (let dy = 0; dy < skala; dy++) {
        for (let dx = 0; dx < skala; dx++) {
          const px = ((y + quiet) * skala + dy) * width + (x + quiet) * skala + dx;
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, width };
}

it('tautan join yang digambar app terbaca kembali persis oleh pemindai', () => {
  const url = `https://paranoidclick.hafizsyq.workers.dev/?sid=AB7K&tok=${'a'.repeat(64)}`;
  const { data, width } = renderModules(url);
  const hasil = jsQR(data, width, width, { inversionAttempts: 'dontInvert' });
  expect(hasil?.data).toBe(url);
});

it('QR yang sama tetap terbaca saat gambar diperkecil seperti frame kamera 320 px', () => {
  const url = `https://paranoidclick.hafizsyq.workers.dev/?sid=Q7RM&tok=${'f'.repeat(64)}`;
  const { data, width } = renderModules(url, 2);
  // Pemindai mengambil frame 320 px lebih dulu; modul 2 px adalah kasus terburuk yang masih
  // masuk akal untuk QR sepanjang ini (versi 4–5), dan decoder harus tetap membacanya.
  expect(width).toBeLessThanOrEqual(320);
  const hasil = jsQR(data, width, width, { inversionAttempts: 'dontInvert' });
  expect(hasil?.data).toBe(url);
});
