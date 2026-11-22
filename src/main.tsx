import { createRoot } from 'react-dom/client';
import { mulaiPemeriksaanUpdate } from './app/offline/update';
import { parseTarget } from './app/session/live';
import { BuildVersion } from './screens/BuildVersion';
import { ClickRoom } from './screens/ClickRoom';
import { DebugScope } from './screens/DebugScope';
import { PwaBanner } from './screens/PwaBanner';
import { Start } from './screens/Start';
import { CookieConsent, CookieManagerButton } from './components/CookieConsent';
import './global.css';

const q = new URLSearchParams(location.search);
const target = parseTarget(location.search);
const ukur = q.get('layar') === 'ukur';
/** Ada `sid`/`tok` tetapi tidak lolos parseTarget: tautan rusak, bukan tamu baru. */
const badLink = !ukur && !target && (q.has('sid') || q.has('tok'));

function App() {
  return (
    <>
      <PwaBanner />
      <BuildVersion />
      {ukur ? (
        <DebugScope />
      ) : target ? (
        <ClickRoom role="follower" target={target} />
      ) : (
        <Start badLink={badLink} />
      )}
      <CookieConsent />
      <CookieManagerButton />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

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
