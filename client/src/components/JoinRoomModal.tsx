import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import { saveSession } from '../lib/session';
import Modal from './ui/Modal';

export default function JoinRoomModal() {
  const navigate = useNavigate();
  const { showJoinModal, joinRoomId, closeJoinModal, addToast } = useUIStore();

  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!showJoinModal || !joinRoomId) return null;

  const handleJoin = () => {
    setError('');
    if (!displayName.trim()) {
      setError('Görünen adınızı girin.');
      return;
    }
    if (!pin.trim()) {
      setError('PIN girin.');
      return;
    }

    setLoading(true);
    const socket = getSocket();

    const handler = (data: any) => {
      socket.off('room:joined', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      closeJoinModal();

      // Save session so RoomPage can auto-rejoin
      if (data?.user) {
        saveSession({
          roomId: joinRoomId,
          userId: data.user.id,
          displayName: data.user.displayName,
          role: data.user.role,
          joinedAt: data.user.joinedAt || Date.now(),
        });
      }

      navigate(`/room/${joinRoomId}`);
    };

    const errorHandler = (data: { message: string }) => {
      socket.off('room:joined', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      setError(data.message);
    };

    socket.on('room:joined', handler);
    socket.on('room:error', errorHandler);

    socket.emit('room:join', {
      roomId: joinRoomId,
      pin: pin.trim(),
      displayName: displayName.trim(),
    });

    setTimeout(() => {
      socket.off('room:joined', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      setError('Sunucu yanıt vermedi.');
    }, 10000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <Modal open={true} onClose={closeJoinModal} title="Odaya Katıl">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Görünen adın"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={24}
          className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
            text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
            transition-colors text-sm"
          autoFocus
        />
        <input
          type="text"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={12}
          className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
            text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
            transition-colors text-sm"
        />
        {error && <p className="text-red-soft text-sm">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-3 bg-red-main text-white font-semibold rounded-xl
            glow-red-sm hover:glow-red transition-all duration-300
            hover:bg-red-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Katılıyor...' : 'Katıl'}
        </button>
      </div>
    </Modal>
  );
}
