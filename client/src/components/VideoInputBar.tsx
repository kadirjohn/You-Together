import { useState } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';

export default function VideoInputBar() {
  const currentUser = useRoomStore((s) => s.currentUser);
  const room = useRoomStore((s) => s.room);
  const { addToast } = useUIStore();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const isAdmin =
    currentUser &&
    (currentUser.role === 'owner' || currentUser.role === 'admin');

  if (!isAdmin || !room) return null;

  const handleSubmit = () => {
    if (!url.trim()) return;
    setLoading(true);

    const socket = getSocket();
    const errorHandler = (data: { message: string }) => {
      socket.off('room:error', errorHandler);
      setLoading(false);
      addToast(data.message, 'error');
    };

    socket.on('room:error', errorHandler);

    socket.emit('video:change', {
      roomId: room.id,
      youtubeUrl: url.trim(),
    });

    setUrl('');

    setTimeout(() => {
      socket.off('room:error', errorHandler);
      setLoading(false);
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="mb-3 flex gap-2">
      <input
        type="text"
        placeholder="YouTube linki yapıştırın"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 px-4 py-2.5 bg-bg-card border border-white/10 rounded-xl
          text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
          transition-colors text-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={loading || !url.trim()}
        className="px-4 py-2.5 bg-red-main text-white font-semibold rounded-xl
          glow-red-sm hover:glow-red transition-all duration-300
          hover:bg-red-soft active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
          text-sm whitespace-nowrap"
      >
        {loading ? '...' : 'Videoyu değiştir'}
      </button>
    </div>
  );
}
