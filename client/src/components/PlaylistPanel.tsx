import { useState } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { detectMediaType } from '../lib/player';
import { generateId } from '../lib/ids';

export default function PlaylistPanel() {
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const playlist = useRoomStore((s) => s.playlist);
  const { addToast } = useUIStore();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';
  if (!room) return null;

  const handleAdd = () => {
    if (!url.trim()) return;
    const mediaType = detectMediaType(url.trim());
    if (!mediaType) {
      addToast('Geçerli bir YouTube linki gir.', 'error');
      return;
    }
    getSocket().emit('playlist:add', {
      roomId: room.id,
      url: url.trim(),
      title: title.trim() || undefined,
    });
    setUrl('');
    setTitle('');
  };

  const handleRemove = (itemId: string) => {
    getSocket().emit('playlist:remove', { roomId: room.id, itemId });
  };

  const handleMove = (itemId: string, direction: 'up' | 'down') => {
    const idx = playlist.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const newIndex = direction === 'up' ? idx - 1 : idx + 1;
    getSocket().emit('playlist:move', { roomId: room.id, itemId, newIndex });
  };

  const handleNext = () => {
    getSocket().emit('playlist:next', { roomId: room.id });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b-[3px] border-white/5 space-y-3">
        <p className="text-text-muted text-sm font-semibold">Sıradaki videolar</p>
        {isAdmin && (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 bg-bg-card cartoon-input text-text-main placeholder-text-muted text-sm font-semibold rounded-xl"
            />
            <input
              type="text"
              placeholder="Başlık"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 bg-bg-card cartoon-input text-text-main placeholder-text-muted text-sm font-semibold rounded-xl"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={!url.trim()}
                className="flex-1 py-2 bg-red-main text-white font-bold rounded-xl cartoon-btn-sm hover:bg-red-soft disabled:opacity-50 text-sm"
              >
                Ekle
              </button>
              <button
                onClick={handleNext}
                className="px-3 py-2 bg-bg-card text-text-main font-bold rounded-xl border-2 border-white/10 hover:border-red-main/50 text-sm"
                title="Sıradakini oynat"
              >
                ▶
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {playlist.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-8">Playlist boş.</p>
        ) : (
          playlist.map((item, idx) => (
            <div
              key={item.id}
              className="p-3 bg-bg-card rounded-xl border-2 border-white/5 flex items-center gap-3"
            >
              <span className="text-text-muted text-sm font-bold w-5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-text-main text-sm font-semibold truncate">
                  {item.title || item.url}
                </p>
                <p className="text-text-muted text-xs truncate">{item.url}</p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleMove(item.id, 'up')}
                    disabled={idx === 0}
                    className="p-1.5 text-text-muted hover:text-red-main disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMove(item.id, 'down')}
                    disabled={idx === playlist.length - 1}
                    className="p-1.5 text-text-muted hover:text-red-main disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-1.5 text-text-muted hover:text-red-main"
                    title="Kaldır"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
