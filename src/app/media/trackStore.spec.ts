import { describe, expect, it } from 'vitest';
import { formatDuration, trackForSong, type TrackMeta } from './trackStore';

const track = (patch: Partial<TrackMeta>): TrackMeta => ({
  id: 't1',
  songId: null,
  title: 'Lagu',
  fileName: 'lagu.mp3',
  mime: 'audio/mpeg',
  size: 1,
  durationMs: 0,
  tuning: '',
  key: '',
  notes: '',
  program: 0,
  addedAt: 0,
  ...patch,
});

describe('trackForSong', () => {
  it('mencocokkan lewat songId lebih dulu daripada judul', () => {
    const tracks = [
      track({ id: 'a', songId: null, title: 'Sama' }),
      track({ id: 'b', songId: 7, title: 'Lain' }),
    ];
    expect(trackForSong(tracks, 7, 'Sama')?.id).toBe('b');
  });

  it('jatuh ke judul yang dinormalkan kalau belum terhubung', () => {
    const tracks = [track({ id: 'a', title: '  Lagu  ' })];
    expect(trackForSong(tracks, 99, 'lagu')?.id).toBe('a');
  });

  it('tidak mengembalikan track milik lagu lain hanya karena judul mirip', () => {
    const tracks = [track({ id: 'a', songId: 3, title: 'Lagu' })];
    expect(trackForSong(tracks, 4, 'Lagu Lain')).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('memakai m:ss dan h:mm:ss, dan tanda pisah untuk durasi tak diketahui', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});
