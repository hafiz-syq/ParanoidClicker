import './global.css';
import { createRoot } from 'react-dom/client';
import { parseTarget } from './app/session/live';
import { ClickRoom } from './screens/ClickRoom';
import { DebugScope } from './screens/DebugScope';
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

createRoot(document.getElementById('root')!).render(view);
