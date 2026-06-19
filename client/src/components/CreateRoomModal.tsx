import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import { saveSession } from '../lib/session';
import Modal from './ui/Modal';

export default function CreateRoomModal() {
  const navigate = useNavigate();
  const { setShowCreateModal, addToast } = useUIStore();

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [roomName, setRoomName] = useState('');
  const [pin, setPin] = useState('');
  const [displayName, setDisplayName] = useState('');
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

      if (data?.user) {
        saveSession({
          roomId: data.roomId,
          userId: data.user.id,
          displayName: data.user.displayName,
          role: data.user.role,
          joinedAt: data.user.joinedAt || Date.now(),
        });
      }

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
        {/* Step 1: YouTube linki (opsiyonel) */}
        <div>
          <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
            1. YouTube Linki <span className="text-text-muted/50">(opsiyonel)</span>
          </label>
          <input
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
              text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
              transition-colors text-sm"
            autoFocus
          />
        </div>

        {/* Step 2: Oda adı */}
        <div>
          <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
            2. Oda Adı
          </label>
          <input
            type="text"
            placeholder="Film Gecesi, Müzik Partisi..."
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={60}
            className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
              text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
              transition-colors text-sm"
          />
        </div>

        {/* Step 3: PIN */}
        <div>
          <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
            3. PIN
          </label>
          <input
            type="text"
            placeholder="En az 4 karakter"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={12}
            className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
              text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
              transition-colors text-sm"
          />
        </div>

        {/* Step 4: Görünen ad */}
        <div>
          <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
            4. Görünen Adın
          </label>
          <input
            type="text"
            placeholder="Herkesin göreceği isim"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={24}
            className="w-full px-4 py-3 bg-bg-card border border-white/10 rounded-xl
              text-text-main placeholder-text-muted focus:outline-none focus:border-red-main/50
              transition-colors text-sm"
          />
        </div>

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
