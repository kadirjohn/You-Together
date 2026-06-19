import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import Modal from './ui/Modal';

export default function CreateRoomModal() {
  const navigate = useNavigate();
  const { setShowCreateModal, addToast } = useUIStore();

  const [roomName, setRoomName] = useState('');
  const [pin, setPin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = () => {
    setError('');

    if (!roomName.trim() || roomName.trim().length < 3) {
      setError('Oda adı en az 3 karakter olmalı.');
      return;
    }
    if (!pin.trim() || pin.trim().length < 4) {
      setError('PIN en az 4 karakter olmalı.');
      return;
    }
    if (!displayName.trim() || displayName.trim().length < 2) {
      setError('Görünen ad en az 2 karakter olmalı.');
      return;
    }

    setLoading(true);

    const socket = getSocket();
    const handler = (data: any) => {
      socket.off('room:created', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      setShowCreateModal(false);
      navigate(`/room/${data.roomId}`);
      addToast('Oda oluşturuldu!', 'success');
    };

    const errorHandler = (data: { message: string }) => {
      socket.off('room:created', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      setError(data.message);
    };

    socket.on('room:created', handler);
    socket.on('room:error', errorHandler);

    socket.emit('room:create', {
      roomName: roomName.trim(),
      pin: pin.trim(),
      displayName: displayName.trim(),
      initialYoutubeUrl: youtubeUrl.trim() || undefined,
    });

    // Timeout
    setTimeout(() => {
      socket.off('room:created', handler);
      socket.off('room:error', errorHandler);
      setLoading(false);
      setError('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
    }, 10000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
  };

  return (
    <Modal open={true} onClose={() => setShowCreateModal(false)} title="Yeni Oda Oluştur">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Oda adı (örn: Film Gecesi)"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={60}
          className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
            text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
            transition-colors text-sm"
          autoFocus
        />
        <input
          type="text"
          placeholder="PIN (4-12 karakter)"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={12}
          className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
            text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
            transition-colors text-sm"
        />
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
        />
        <input
          type="text"
          placeholder="YouTube linki (opsiyonel)"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
            text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
            transition-colors text-sm"
        />
        {error && <p className="text-red-soft text-sm">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full py-3 bg-red-main text-white font-semibold rounded-xl
            glow-red-sm hover:glow-red transition-all duration-300
            hover:bg-red-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Oluşturuluyor...' : 'Oda Oluştur'}
        </button>
      </div>
    </Modal>
  );
}
