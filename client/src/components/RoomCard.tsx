import type { PublicRoomSummary } from '../lib/socket';

interface RoomCardProps {
  room: PublicRoomSummary;
  onJoin: () => void;
}

export default function RoomCard({ room, onJoin }: RoomCardProps) {
  const thumbnailUrl = room.playback.videoId
    ? `https://img.youtube.com/vi/${room.playback.videoId}/mqdefault.jpg`
    : null;

  const statusLabel =
    room.playback.videoId && room.playback.status === 'playing'
      ? 'İzleniyor'
      : room.playback.videoId
        ? 'Bekliyor'
        : 'Boş';

  return (
    <div
      className="group bg-bg-card rounded-3xl overflow-hidden
        cartoon-card cursor-pointer animate-fade-in"
      onClick={onJoin}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-bg-panel overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={room.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl animate-float">
            🎬
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent" />
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-extrabold text-text-main truncate mb-2 text-base">{room.name}</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-text-muted font-bold">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {room.userCount}/{room.maxUsers}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-xl font-bold border-2 ${
              statusLabel === 'İzleniyor'
                ? 'bg-red-main/20 text-red-soft border-red-main/20'
                : statusLabel === 'Bekliyor'
                  ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20'
                  : 'bg-white/5 text-text-muted border-white/5'
            }`}>
              {statusLabel === 'İzleniyor' ? '▶ İzleniyor' : statusLabel === 'Bekliyor' ? '⏸ Bekliyor' : '○ Boş'}
            </span>
          </div>
          <button
            className={`px-4 py-2 text-xs font-extrabold rounded-xl transition-all duration-200 ${
              room.userCount >= room.maxUsers
                ? 'bg-white/5 text-text-muted cursor-not-allowed border-2 border-white/5'
                : 'bg-red-main text-white cartoon-btn-sm hover:bg-red-soft'
            }`}
            disabled={room.userCount >= room.maxUsers}
            onClick={(e) => {
              e.stopPropagation();
              onJoin();
            }}
          >
            {room.userCount >= room.maxUsers ? 'Dolu 😔' : 'Katıl →'}
          </button>
        </div>
      </div>
    </div>
  );
}
