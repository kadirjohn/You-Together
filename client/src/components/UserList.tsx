import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';

export default function UserList() {
  const users = useRoomStore((s) => s.users);
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const { addToast } = useUIStore();

  const isOwner = currentUser?.role === 'owner';

  const handleGrantAdmin = (targetUserId: string) => {
    if (!room) return;
    getSocket().emit('admin:grant', { roomId: room.id, targetUserId });
  };

  const handleRevokeAdmin = (targetUserId: string) => {
    if (!room) return;
    getSocket().emit('admin:revoke', { roomId: room.id, targetUserId });
  };

  const roleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <span className="text-xs bg-red-main/20 text-red-soft px-2 py-0.5 rounded-full font-semibold">Sahip</span>;
      case 'admin':
        return <span className="text-xs bg-red-soft/15 text-red-soft/80 px-2 py-0.5 rounded-full">Admin</span>;
      default:
        return <span className="text-xs bg-white/5 text-text-muted px-2 py-0.5 rounded-full">İzleyici</span>;
    }
  };

  return (
    <div className="bg-bg-panel border border-white/5 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <span className="text-sm font-semibold text-text-main">
          Kullanıcılar ({users.length}/{room?.maxUsers || 10})
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-2 bg-bg-card rounded-xl px-3 py-2 border border-white/5
              hover:border-white/10 transition-all duration-300 group"
          >
            <div className="w-7 h-7 rounded-full bg-red-main/15 flex items-center justify-center text-xs font-bold text-red-soft">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-text-main leading-tight">
                {user.displayName}
                {user.id === currentUser?.id && (
                  <span className="text-text-muted ml-1">(Sen)</span>
                )}
              </span>
              {roleBadge(user.role)}
            </div>

            {/* Admin controls for owner */}
            {isOwner && user.id !== currentUser?.id && user.role !== 'owner' && (
              <div className="hidden group-hover:flex items-center gap-1 ml-1">
                {user.role === 'member' ? (
                  <button
                    onClick={() => handleGrantAdmin(user.id)}
                    className="text-xs text-text-muted hover:text-red-soft transition-colors px-1"
                    title="Admin yap"
                  >
                    ↑
                  </button>
                ) : (
                  <button
                    onClick={() => handleRevokeAdmin(user.id)}
                    className="text-xs text-text-muted hover:text-red-soft transition-colors px-1"
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
