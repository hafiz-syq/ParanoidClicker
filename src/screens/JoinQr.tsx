import { useEffect, useRef } from 'react';
import { drawQr } from '../app/qr';

/**
 * Tautan join sebagai QR. Yang dikodekan adalah alamat yang sama dengan tautan teks — `sid`
 * + `tok`, TIDAK PERNAH `lk` — jadi memindai QR memberi kapabilitas anggota, bukan podium.
 * Kotaknya putih dan modulnya hitam: kamera butuh kontras, bukan tema gelap aplikasi.
 */
export function JoinQr({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      drawQr(canvas, url);
    } catch {
      return;
    }
    // `catch` bukan hiasan: canvas yang sudah dilepas saat render ulang bisa tidak punya
    // konteks 2d, dan lemparan tanpa penanganan mematikan seluruh layar di React 19. Tanpa
    // QR pun tautan teks dan tombol salin tetap ada, jadi layar harus hidup.
  }, [url]);

  return (
    <canvas ref={ref} className="qr" role="img" aria-label="QR tautan join sesi ini" />
  );
}
