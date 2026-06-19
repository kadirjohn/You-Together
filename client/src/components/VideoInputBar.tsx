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
      <div className="relative flex-1 input-icon-group">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
          <svg className="w-5 h-5 text-red-main" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="YouTube linkini yapıştır"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full pl-11 pr-4 py-2.5 bg-bg-card cartoon-input
            text-text-main placeholder-text-muted focus:outline-none
            text-sm font-semibold"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading || !url.trim()}
        className="px-5 py-2.5 bg-red-main text-white font-extrabold rounded-2xl
          cartoon-btn-sm hover:bg-red-soft disabled:opacity-50 disabled:cursor-not-allowed
          disabled:transform-none text-sm whitespace-nowrap"
      >
        {loading ? '...' : 'Oynat'}
      </button>
    </div>
  );
}
