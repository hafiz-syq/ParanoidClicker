/**
 * Pemutar backing track di AudioContext yang sama dengan klik.
 *
 * File di-decode ke AudioBuffer lalu diputar lewat kanal `backing` milik Mixer. Tidak ada
 * elemen <audio> kedua: elemen itu punya jam sendiri dan tidak bisa dipanning/disolo
 * bersama klik.
 */
export class BackingPlayer {
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offsetS = 0;
  private loop = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode
  ) {}

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  get isPlaying(): boolean {
    return this.src !== null;
  }

  async load(data: ArrayBuffer): Promise<number> {
    this.stop();
    // decodeAudioData memindahkan (detach) ArrayBuffer; salinan menjaga data asli di
    // IndexedDB tetap utuh kalau track yang sama diputar lagi.
    this.buffer = await this.ctx.decodeAudioData(data.slice(0));
    this.offsetS = 0;
    return this.durationMs;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.src) this.src.loop = loop;
  }

  play(): boolean {
    if (!this.buffer) return false;
    if (this.src) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    src.connect(this.out);
    const mulai = Math.min(this.offsetS, Math.max(0, this.buffer.duration - 0.01));
    src.start(0, mulai);
    this.startedAt = this.ctx.currentTime;
    this.src = src;
    src.onended = () => {
      if (this.src !== src) return;
      this.src = null;
      // Loop=false: kembali ke awal supaya tombol Play berikutnya tidak memutar dari
      // ekor yang tinggal sepersekian detik.
      if (!this.loop) this.offsetS = 0;
    };
    return true;
  }

  pause(): void {
    if (!this.src) return;
    this.offsetS += this.ctx.currentTime - this.startedAt;
    this.stopSource();
  }

  stop(): void {
    this.offsetS = 0;
    this.stopSource();
  }

  private stopSource(): void {
    const src = this.src;
    this.src = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // sudah berhenti sendiri
    }
    src.disconnect();
  }
}
