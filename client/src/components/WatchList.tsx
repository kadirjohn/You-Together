import { useRef, useEffect } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import type { WatchedVideo } from '../lib/socket';

// Süre (saniye) -> "1:02:03" / "12:34" / "--:--" biçimi. AdminControlBar ile aynı format tutarlı.
function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function WatchList() {
  const watchlist = useRoomStore((s) => s.watchlist);
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const { addToast } = useUIStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAdmin =
    currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
  const currentVideoId = room?.playback.videoId ?? null;

  // Liste değişince en üste (en yeniye) kay
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [watchlist.length]);

  const handleReplay = (video: WatchedVideo) => {
    if (!room) return;
    if (!isAdmin) {
      addToast('Video tekrar oynatma yetkiniz yok. Adminlerden birine söyleyin.', 'warning');
      return;
    }
    // Mevcut video:change akışını tetikle — bu, sunucuda meta fetch + watchlist'e
    // tekrar ekleme (en üste taşıma) + tüm odaya broadcast yapar.
    getSocket().emit('video:change', {
      roomId: room.id,
      youtubeUrl: `https://youtu.be/${video.videoId}`,
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {watchlist.length === 0 && (
          <div className="text-center text-text-muted text-sm py-8 font-bold animate-bounce-in">
            <div className="text-4xl mb-2">📺</div>
            Henüz video izlenmedi.
            <p className="text-text-muted/60 text-xs mt-1 font-semibold">
              Admin bir video başlatınca burada birikecek.
            </p>
          </div>
        )}

        {/* En yeni üstte: tersine çevir (listenin sonu = en yeni eklendi) */}
        {[...watchlist].reverse().map((video) => {
          const isActive = video.videoId === currentVideoId;
          return (
            <button
              key={video.videoId}
              onClick={() => handleReplay(video)}
              className={`w-full flex gap-3 p-2 rounded-2xl text-left transition-all duration-200 group
                ${isActive
                  ? 'bg-red-main/15 border-2 border-red-main/30'
                  : 'bg-bg-card border-2 border-white/5 hover:border-red-main/20'}
                ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
              title={isAdmin ? 'Tekrar oynat' : 'Yalnızca admin tekrar oynatabilir'}
            >
              {/* Thumbnail */}
              <div className="relative w-24 shrink-0 aspect-video rounded-lg overflow-hidden bg-bg-panel">
                {video.thumbnail ? (
                  <img
                    src={video.thumbnail}
                    alt={video.title || 'Video'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🎬</div>
                )}
                {/* Süre badge */}
                <span className="absolute bottom-1 right-1 text-[10px] font-bold bg-black/80 text-white px-1.5 py-0.5 rounded-md font-mono">
                  {formatDuration(video.durationSeconds)}
                </span>
                {/* Aktif oynatma göstergesi */}
                {isActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="text-red-main text-lg">▶</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span className="text-xs font-bold text-text-main leading-snug line-clamp-2">
                  {video.title || `https://youtu.be/${video.videoId}`}
                </span>
                {video.channel && (
                  <span className="text-[11px] text-text-muted font-semibold mt-0.5 truncate">
                    {video.channel}
                  </span>
                )}
                <span className="text-[10px] text-text-muted/70 font-semibold mt-1">
                  {video.addedBy.displayName} ekledi
                </span>
              </div>

              {/* Tekrar oynat ikonu (admin hover) */}
              {isAdmin && !isActive && (
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-red-main/0 group-hover:bg-red-main/15 text-text-muted group-hover:text-red-main transition-all duration-200 shrink-0 self-center">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
