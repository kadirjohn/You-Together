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
      className="group bg-bg-card border border-white/5 rounded-2xl overflow-hidden
        hover:border-red-main/20 hover:shadow-[0_0_20px_rgba(255,0,51,0.1)]
        transition-all duration-300 cursor-pointer animate-fade-in"
      onClick={onJoin}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-bg-panel overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={room.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">
            🎬
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent" />
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-text-main truncate mb-2">{room.name}</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {room.userCount}/{room.maxUsers}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              statusLabel === 'İzleniyor'
                ? 'bg-red-main/20 text-red-soft'
                : 'bg-white/5 text-text-muted'
            }`}>
              {statusLabel}
            </span>
          </div>
          <button
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-300 ${
              room.userCount >= room.maxUsers
                ? 'bg-white/5 text-text-muted cursor-not-allowed'
                : 'bg-red-main text-white hover:bg-red-soft glow-red-sm hover:glow-red'
            }`}
            disabled={room.userCount >= room.maxUsers}
            onClick={(e) => {
              e.stopPropagation();
              onJoin();
            }}
          >
            {room.userCount >= room.maxUsers ? 'Dolu' : 'Katıl'}
          </button>
        </div>
      </div>
    </div>
  );
}
