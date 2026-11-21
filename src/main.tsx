import './global.css';
import { createRoot } from 'react-dom/client';
import { mulaiPemeriksaanUpdate } from './app/offline/update';
import { parseTarget } from './app/session/live';
import { BuildVersion } from './screens/BuildVersion';
import { ClickRoom } from './screens/ClickRoom';
import { DebugScope } from './screens/DebugScope';
import { PwaBanner } from './screens/PwaBanner';
import { Start } from './screens/Start';

const q = new URLSearchParams(location.search);
const target = parseTarget(location.search);

// Tautan join masuk lewat URL karena itulah yang bisa dikirim lewat WA hari ini;
// QR (M4) hanya akan membungkus alamat yang sama.
const view =
  q.get('layar') === 'ukur'
    ? <DebugScope />
    : target
      ? <ClickRoom role="follower" target={target} />
      : <Start badLink={q.has('sid') || q.has('tok')} />;

createRoot(document.getElementById('root')!).render(
  <>
    <PwaBanner />
    <BuildVersion />
    {view}
  </>,
);

// M7: shell disimpan service worker agar reload tanpa worker tetap merender halaman. Dev server
// Vite tidak menyajikan /sw.js, jadi kegagalan di sini normal dan tidak boleh mengganggu aplikasi.
// Sesudah registrasi, jadwalkan pemeriksaan `sw.js` berkala: tab yang dibiarkan terbuka tidak boleh
// tertinggal build hanya karena tidak pernah dinavigasi ulang. SW baru tetap menunggu; banner yang
// menahannya selama lagu berjalan.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => mulaiPemeriksaanUpdate(reg))
    .catch(() => undefined);
}
