/**
 * Web MIDI minimal: Start (0xFA), Stop (0xFC), Clock (0xF8), dan Program Change (0xC0).
 *
 * Clock dikirim dari jam dinding 24 pulse per quarter, bukan dari ClickEngine: MIDI Clock
 * adalah protokol satu arah yang tidak punya konsep anchor server. Untuk band, yang penting
 * Start/Stop dan Program Change tiba di urutan yang benar; klik tetap didengar dari speaker.
 */
export interface MidiDevice {
  id: string;
  name: string;
}

export interface MidiState {
  supported: boolean;
  inputs: MidiDevice[];
  outputs: MidiDevice[];
  error?: string;
}

export class MidiController {
  private access: MIDIAccess | null = null;
  private out: MIDIOutput | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private bpm = 120;

  async init(): Promise<MidiState> {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      return { supported: false, inputs: [], outputs: [], error: 'Web MIDI tidak didukung browser ini' };
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      return this.state();
    } catch (e) {
      return { supported: false, inputs: [], outputs: [], error: `MIDI ditolak: ${String(e)}` };
    }
  }

  state(): MidiState {
    if (!this.access) {
      return { supported: typeof navigator.requestMIDIAccess === 'function', inputs: [], outputs: [] };
    }
    const ambilInput = (map: MIDIInputMap): MidiDevice[] =>
      Array.from(map.values()).map((d) => ({ id: d.id, name: d.name ?? 'tanpa nama' }));
    const ambilOutput = (map: MIDIOutputMap): MidiDevice[] =>
      Array.from(map.values()).map((d) => ({ id: d.id, name: d.name ?? 'tanpa nama' }));
    return { supported: true, inputs: ambilInput(this.access.inputs), outputs: ambilOutput(this.access.outputs) };
  }

  selectOutput(id: string): void {
    this.out = this.access?.outputs.get(id) ?? null;
  }

  start(): void {
    this.send([0xfa]);
    this.startClock();
  }

  stop(): void {
    this.stopClock();
    this.send([0xfc]);
  }

  program(program: number): void {
    this.send([0xc0, Math.max(0, Math.min(127, Math.round(program)))]);
  }

  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.bpm = bpm;
    if (this.clock !== null) this.startClock();
  }

  private send(data: number[]): void {
    try {
      this.out?.send(data);
    } catch {
      // Kabel MIDI dicabut di tengah lagu bukan alasan untuk mematikan metronom.
    }
  }

  private startClock(): void {
    this.stopClock();
    // 24 pulse per quarter note. Interval dijepit 4 ms supaya BPM 300 tidak membuat
    // browser antre timer yang lebih rapat daripada yang bisa dilayaninya.
    const ms = Math.max(4, 60_000 / this.bpm / 24);
    this.clock = setInterval(() => this.send([0xf8]), ms);
  }

  private stopClock(): void {
    if (this.clock !== null) clearInterval(this.clock);
    this.clock = null;
  }
}
