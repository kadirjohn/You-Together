import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';

export default function UserList() {
  const users = useRoomStore((s) => s.users);
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const { addToast } = useUIStore();

  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  const handleGrantAdmin = (targetUserId: string) => {
    if (!room) return;
    getSocket().emit('admin:grant', { roomId: room.id, targetUserId });
  };

  const handleRevokeAdmin = (targetUserId: string) => {
    if (!room) return;
    getSocket().emit('admin:revoke', { roomId: room.id, targetUserId });
  };

  // Color palette for avatars
  const avatarColors = [
    'bg-red-main/20 text-red-soft',
    'bg-pink-500/20 text-pink-400',
    'bg-purple-500/20 text-purple-400',
    'bg-blue-500/20 text-blue-400',
    'bg-cyan-500/20 text-cyan-400',
    'bg-green-500/20 text-green-400',
    'bg-yellow-500/20 text-yellow-400',
    'bg-orange-500/20 text-orange-400',
  ];

  const getAvatarColor = (index: number) => avatarColors[index % avatarColors.length];

  const roleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <span className="text-xs bg-red-main/20 text-red-soft px-2 py-0.5 rounded-lg font-bold border border-red-main/20">👑 Sahip</span>;
      case 'admin':
        return <span className="text-xs bg-red-soft/15 text-red-soft/80 px-2 py-0.5 rounded-lg font-bold border border-red-soft/15">⭐ Admin</span>;
      default:
        return <span className="text-xs bg-white/5 text-text-muted px-2 py-0.5 rounded-lg font-bold border border-white/5">İzleyici</span>;
    }
  };

  return (
    <div className="bg-bg-panel border-[3px] border-white/5 rounded-2xl p-3 shadow-cartoon-sm">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-red-main" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <span className="text-sm font-extrabold text-text-main">
          Odadakiler ({users.length}/{room?.maxUsers || 10})
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {users.map((user, index) => (
          <div
            key={user.id}
            className="flex items-center gap-2 bg-bg-card rounded-2xl px-3 py-2 border-2 border-white/5
              hover:border-red-main/20 transition-all duration-200 group"
          >
            <div className={`w-8 h-8 rounded-xl ${getAvatarColor(index)} flex items-center justify-center
              text-xs font-extrabold border-2 border-white/10`}>
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-text-main leading-tight">
                {user.displayName}
                {user.id === currentUser?.id && (
                  <span className="text-text-muted ml-1">(Sen)</span>
                )}
              </span>
              {roleBadge(user.role)}
            </div>

            {/* Yetki yönetimi — admin + sahip (owner olmayan hedeflere) */}
            {isAdmin && user.id !== currentUser?.id && user.role !== 'owner' && (
              <div className="hidden group-hover:flex items-center gap-1 ml-1">
                {user.role === 'member' ? (
                  <button
                    onClick={() => handleGrantAdmin(user.id)}
                    className="text-xs text-text-muted hover:text-red-soft transition-colors px-1.5 py-0.5
                      rounded-lg hover:bg-red-main/10 font-bold"
                    title="Admin yap"
                  >
                    ↑
                  </button>
                ) : (
                  <button
                    onClick={() => handleRevokeAdmin(user.id)}
                    className="text-xs text-text-muted hover:text-red-soft transition-colors px-1.5 py-0.5
                      rounded-lg hover:bg-red-main/10 font-bold"
                    title="Adminliği al"
                  >
                    ↓
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
