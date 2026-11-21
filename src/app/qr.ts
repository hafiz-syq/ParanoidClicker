import { encode } from 'uqr';

/**
 * Satu tempat yang memutuskan bentuk QR aplikasi ini: tingkat koreksi `M` dan quiet zone 4
 * modul. Layar dan tes membaca dari sini, bukan memanggil encoder dengan pengaturan
 * masing-masing — dua pengaturan yang berbeda berarti tes membuktikan matriks yang tidak
 * pernah digambar aplikasi.
 *
 * `uqr` dipilih menggantikan `qrcode`: encoder yang sama-sama tanpa renderer Node, tapi tanpa
 * 29 paket bawaan, dan matriksnya identik ukuran untuk tautan join (versi 7, 45 modul).
 */
/** Sisi tampil `.qr` di global.css; satu-satunya ukuran yang dipakai layar. */
const QR_PX = 220;

/**
 * Matriks telanjang, untuk tes dan untuk apa pun yang menggambar sendiri: `size` = sisi dalam
 * modul TANPA quiet zone, `modules[y][x]` = true berarti modul hitam.
 */
export function qrMatrix(text: string): { size: number; modules: boolean[][] } {
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  return { size, modules: data };
}

/**
 * Gambar QR ke canvas selebar ±220 px. Satu modul = bilangan bulat piksel, jadi tidak ada
 * modul yang lebih lebar dari tetangganya; CSS yang memperbesar/memperkecil hasilnya ke ukuran
 * layar. `border: 4` adalah quiet zone yang dibutuhkan kamera — tanpa itu pemindai melihat pola
 * Finder menempel di tepi gambar.
 */
export function drawQr(canvas: HTMLCanvasElement, text: string): void {
  const { size, data } = encode(text, { ecc: 'M', border: 4 });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d tidak tersedia');
  const skala = Math.max(1, Math.floor(QR_PX / size));
  const px = skala * size;
  canvas.width = px;
  canvas.height = px;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]?.[x]) ctx.fillRect(x * skala, y * skala, skala, skala);
    }
  }
}
