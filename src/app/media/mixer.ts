/**
 * Mixer tiga kanal di atas satu AudioContext milik ClickEngine.
 *
 * Klik, hitungan masuk, dan backing track harus keluar dari jam audio yang sama; kalau
 * backing punya AudioContext sendiri, dua jam itu bisa bergeser tanpa terlihat di angka
 * mana pun. Karena itu kanal di sini hanya GainNode + StereoPanner yang dipasang ke
 * `destination` milik context yang sudah dipakai klik.
 */
export type MixChannel = 'click' | 'countIn' | 'backing';

export interface MixState {
  volume: Record<MixChannel, number>;
  muted: Record<MixChannel, boolean>;
  /** Satu kanal solo; null = semua kanal yang tidak di-mute berbunyi. */
  solo: MixChannel | null;
  /** true = klik/k hitungan ke kiri, backing ke kanan. */
  split: boolean;
}

export const CHANNELS: MixChannel[] = ['click', 'countIn', 'backing'];

export const DEFAULT_MIX: MixState = {
  volume: { click: 0.8, countIn: 0.8, backing: 0.55 },
  muted: { click: false, countIn: false, backing: false },
  solo: null,
  split: false,
};

interface ChannelNodes {
  gain: GainNode;
  pan: StereoPannerNode | null;
}

export class Mixer {
  readonly ctx: AudioContext;
  private readonly nodes: Record<MixChannel, ChannelNodes>;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const buat = (): ChannelNodes => {
      const gain = ctx.createGain();
      // Safari lama tidak punya StereoPanner; tanpa pan, split hanya mematikan kanal
      // kanan/kiri lewat gain, dan itu lebih baik daripada mixer yang tidak hidup.
      const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (pan) gain.connect(pan).connect(ctx.destination);
      else gain.connect(ctx.destination);
      return { gain, pan };
    };
    this.nodes = { click: buat(), countIn: buat(), backing: buat() };
    this.apply(DEFAULT_MIX);
  }

  /** Titik masuk untuk ClickEngine / BackingPlayer. */
  input(ch: MixChannel): AudioNode {
    return this.nodes[ch].gain;
  }

  apply(state: MixState): void {
    for (const ch of CHANNELS) {
      const audible = !state.muted[ch] && (state.solo === null || state.solo === ch);
      const volume = Math.min(1, Math.max(0, state.volume[ch]));
      this.nodes[ch].gain.gain.value = audible ? volume : 0;
      if (this.nodes[ch].pan) {
        this.nodes[ch].pan.pan.value = state.split ? (ch === 'backing' ? 1 : -1) : 0;
      }
    }
  }
}

/**
 * Pindahkan seluruh output (klik + backing) ke perangkat lain. `setSinkId` di AudioContext
 * belum ada di semua browser; kegagalan dikembalikan sebagai kalimat, bukan dilempar,
 * karena layar harus tetap bisa memakai speaker bawaan.
 */
export async function pindahOutput(ctx: AudioContext, deviceId: string): Promise<string> {
  const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (!c.setSinkId) return 'setSinkId tidak didukung browser ini — output tetap di perangkat bawaan';
  try {
    await c.setSinkId(deviceId);
    return 'output audio dipindah';
  } catch (e) {
    return `gagal pindah output: ${String(e)}`;
  }
}
