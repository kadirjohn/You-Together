import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import { saveSession } from '../lib/session';
import Modal from './ui/Modal';

export default function CreateRoomModal() {
  const navigate = useNavigate();
  const { setShowCreateModal, addToast } = useUIStore();

  const [step, setStep] = useState<'url' | 'details'>('url');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [roomName, setRoomName] = useState('');
  const [pin, setPin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleContinue = () => {
    setError('');
    setStep('details');
  };

  const handleBack = () => {
    setError('');
    setStep('url');
  };

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
    if (e.key === 'Enter') {
      if (step === 'url') handleContinue();
      else handleCreate();
    }
  };

  const title = step === 'url' ? 'Yeni Oda — Video Seç' : 'Yeni Oda — Detaylar';

  return (
    <Modal open={true} onClose={() => setShowCreateModal(false)} title={title}>
      {step === 'url' ? (
        /* ── Step 1: YouTube link ── */
        <div className="space-y-4">
          <p className="text-text-muted text-sm">
            Beraber izlemek istediğin YouTube videosunun linkini yapıştır.
            <br />
            <span className="text-text-muted/50">İstersen boş bırakıp sonra da ekleyebilirsin.</span>
          </p>
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
          <div className="flex gap-2">
            <button
              onClick={handleContinue}
              className="flex-1 py-3 bg-red-main text-white font-semibold rounded-xl
                glow-red-sm hover:glow-red transition-all duration-300
                hover:bg-red-soft active:scale-[0.98]"
            >
              {youtubeUrl.trim() ? 'Devam Et' : 'Atla ve Devam Et'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Step 2: Room details ── */
        <div className="space-y-3">
          {/* Back button */}
          <button
            onClick={handleBack}
            className="text-text-muted hover:text-text-main text-sm transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Video linkini değiştir
          </button>

          {/* YouTube URL summary */}
          {youtubeUrl.trim() && (
            <div className="px-3 py-2 bg-bg-card border border-white/5 rounded-lg text-xs text-text-muted truncate">
              🎥 {youtubeUrl}
            </div>
          )}

          <div>
            <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
              Oda Adı
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
              autoFocus
            />
          </div>

          <div>
            <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
              PIN
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

          <div>
            <label className="block text-text-muted text-xs font-medium mb-1.5 uppercase tracking-wide">
              Görünen Adın
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
      )}
    </Modal>
  );
}
