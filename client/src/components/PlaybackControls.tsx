import { useState } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import SubtitleModal from './SubtitleModal';

const RATES = [0, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function PlaybackControls() {
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const playbackRate = useRoomStore((s) => s.room?.playback.playbackRate ?? 0);
  const loop = useRoomStore((s) => s.room?.playback.loop ?? false);
  const mediaType = useRoomStore((s) => s.room?.playback.mediaType);
  const [subtitleOpen, setSubtitleOpen] = useState(false);

  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';
  if (!room || !isAdmin) return null;

  const setRate = (rate: number) => {
    getSocket().emit('playback:rate', {
      roomId: room.id,
      rate,
      clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });
  };

  const setLoop = (value: boolean) => {
    getSocket().emit('playback:loop', {
      roomId: room.id,
      loop: value,
      clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });
  };

  const showSubtitle = mediaType === 'mp4' || mediaType === 'hls';

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-bg-card border-2 border-white/10 rounded-xl px-2 py-1.5">
        <span className="text-text-muted text-xs font-bold">Hız</span>
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => setRate(r)}
            className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${
              playbackRate === r
                ? 'bg-red-main text-white'
                : 'text-text-muted hover:text-text-main hover:bg-white/5'
            }`}
            title={r === 0 ? 'Otomatik senkron' : `${r}x`}
          >
            {r === 0 ? 'Auto' : `${r}x`}
          </button>
        ))}
      </div>

      <button
        onClick={() => setLoop(!loop)}
        className={`px-3 py-1.5 rounded-xl border-2 text-xs font-bold transition-colors ${
          loop
            ? 'bg-red-main text-white border-red-main'
            : 'bg-bg-card text-text-muted border-white/10 hover:text-text-main'
        }`}
      >
        {loop ? 'Loop: Açık' : 'Loop: Kapalı'}
      </button>

      {showSubtitle && (
        <button
          onClick={() => setSubtitleOpen(true)}
          className="px-3 py-1.5 bg-bg-card text-text-muted border-2 border-white/10 rounded-xl text-xs font-bold hover:text-text-main"
        >
          Altyazı
        </button>
      )}

      <SubtitleModal open={subtitleOpen} onClose={() => setSubtitleOpen(false)} />
    </div>
  );
}
