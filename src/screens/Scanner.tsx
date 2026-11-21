import { useEffect, useRef, useState } from 'react';

const FRAME_MS = 200;
// Lebar sampel, bukan lebar tayangan: decode 320 px cukup untuk QR sepanjang tautan join dan
// 10x lebih murah daripada membaca frame kamera resolusi penuh dua belas kali per detik.
const SAMPLE_WIDTH = 320;

type Decoder = typeof import('jsqr').default;

export interface ScannerProps {
  onResult: (text: string) => void;
  onBatal: () => void;
}

/**
 * Pemindai QR di dalam app. Kamera hanya dipakai selama layar ini terbuka, dan setiap track
 * dihentikan saat komponen dilepas — lampu kamera yang menyala setelah orang keluar layar
 * adalah bug kepercayaan, bukan detail.
 */
export function Scanner({ onResult, onBatal }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState('menyalakan kamera…');
  // Callback disimpan di ref: kalau ia masuk daftar dependensi, setiap render layar induk
  // mematikan kamera lalu menyalakannya lagi.
  const hasilRef = useRef(onResult);
  hasilRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let selesai = false;
    // Diisi sesudah `import('jsqr')` selesai; `scan` yang berjalan sebelum itu tidak membaca apa pun.
    let decode: Decoder | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const stop = () => {
      selesai = true;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const scan = () => {
      const video = videoRef.current;
      const baca = decode;
      if (selesai || !baca || !video || !ctx || video.readyState < 2 || video.videoWidth === 0) return;
      const w = SAMPLE_WIDTH;
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      // `dontInvert`: QR selalu gelap di atas terang, dan mencoba dua inversi menggandakan
      // biaya decode tiap frame tanpa menambah satu pun kasus yang berhasil.
      const code = baca(frame.data, w, h, { inversionAttempts: 'dontInvert' });
      if (!code?.data) return;
      stop();
      hasilRef.current(code.data);
    };

    void (async () => {
      try {
        // Decoder 130 kB hanya diunduh ketika seseorang benar-benar menekan "Pindai QR", bukan
        // oleh setiap HP yang membuka app — impor statis di puncak berkas menaruhnya di bundel awal.
        decode = (await import('jsqr')).default;
      } catch (e) {
        setStatus(`pemindai tidak bisa dimuat: ${String(e)}`);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        setStatus(`kamera tidak bisa dibuka: ${String(e)}`);
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus('arahkan kamera ke QR di layar pemimpin');
      timer = window.setInterval(scan, FRAME_MS);
    })();

    return stop;
  }, []);

  return (
    <div>
      <video ref={videoRef} className="video" muted playsInline />
      <p className="small">{status}</p>
      <button onClick={onBatal} className="btn">
        Batal
      </button>
    </div>
  );
}
