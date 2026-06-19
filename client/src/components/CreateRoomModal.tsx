import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import { saveSession } from '../lib/session';
import Modal from './ui/Modal';

/* ── Inline SVG Icons (cartoonish, thick stroke) ── */
const RoomIcon = () => (
  <svg className="w-5 h-5 text-red-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 4l9 5.5" />
    <path d="M19 13v6a1 1 0 01-1 1H6a1 1 0 01-1-1v-6" />
    <rect x="9" y="14" width="6" height="6" rx="1" />
  </svg>
);

const UserIcon = () => (
  <svg className="w-5 h-5 text-red-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
  </svg>
);

const LockIcon = () => (
  <svg className="w-5 h-5 text-red-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
    <circle cx="12" cy="16" r="1.5" fill="currentColor" />
  </svg>
);

const EyeOpenIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosedIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

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
  const [pinVisible, setPinVisible] = useState(true);
  const [showEye, setShowEye] = useState(false);

  const handleContinue = () => {
    setError('');
    setStep('details');
  };

  const handleBack = () => {
    setError('');
    setStep('url');
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPin(val);
    if (val.length === 1 && !showEye) {
      setShowEye(true);
    }
    if (val.length === 0) {
      setShowEye(false);
      setPinVisible(true);
    }
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
      addToast('Oda oluşturuldu! 🎉', 'success');
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
      setError('Sunucu yanıt vermedi. Lütfen tekrar dene.');
    }, 10000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (step === 'url') handleContinue();
      else handleCreate();
    }
  };

  const title = step === 'url' ? 'Video Seç' : 'Oda Bilgileri';

  return (
    <Modal open={true} onClose={() => setShowCreateModal(false)} title={title}>
      {step === 'url' ? (
        /* ── Step 1: YouTube link ── */
        <div className="space-y-4">
          <p className="text-text-muted text-base font-bold">
            İzlemek istediğin YouTube linkini buraya yapıştır!
            <br />
            <span className="text-text-muted/50 text-sm font-semibold">Video linki sonra da eklenebilir</span>
          </p>
          <div className="relative input-icon-group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
              <svg className="w-5 h-5 text-red-main" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-11 pr-4 py-3 bg-bg-card cartoon-input
                text-text-main placeholder-text-muted focus:outline-none
                text-base font-semibold"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleContinue}
              className="flex-1 py-3 bg-red-main text-white font-extrabold rounded-2xl
                cartoon-btn hover:bg-red-soft text-base"
            >
              {youtubeUrl.trim() ? 'Devam Et →' : 'Linki sonra ekle →'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Step 2: Room details ── */
        <div className="space-y-4">
          {/* Back button */}
          <button
            onClick={handleBack}
            className="text-text-muted hover:text-red-main text-lg font-extrabold transition-all duration-200 flex items-center gap-1.5
              hover:translate-x-[-2px] whitespace-nowrap"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Videoyu değiştir
          </button>

          {/* YouTube URL summary */}
          {youtubeUrl.trim() && (
            <div className="px-3.5 py-2.5 bg-bg-card border-2 border-white/5 rounded-xl text-sm text-text-muted truncate font-semibold">
              🎥 {youtubeUrl}
            </div>
          )}

          {/* Room Name */}
          <div>
            <label className="block text-text-muted text-sm font-black mb-1.5 uppercase tracking-wider">
              Oda Adı
            </label>
            <div className="relative input-icon-group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
                <RoomIcon />
              </div>
              <input
                type="text"
                placeholder="Örn. Film gecesi"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={60}
                className="w-full pl-11 pr-4 py-3 bg-bg-card cartoon-input
                  text-text-main placeholder-text-muted focus:outline-none
                  text-base font-semibold"
                autoFocus
              />
            </div>
          </div>

          {/* PIN */}
          <div>
            <label className="block text-text-muted text-sm font-black mb-1.5 uppercase tracking-wider">
              PIN
            </label>
            <div className="relative input-icon-group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
                <LockIcon />
              </div>
              <input
                type={pinVisible ? 'text' : 'password'}
                placeholder="En az 4 karakter"
                value={pin}
                onChange={handlePinChange}
                onKeyDown={handleKeyDown}
                maxLength={12}
                className="w-full pl-11 pr-12 py-3 bg-bg-card cartoon-input
                  text-text-main placeholder-text-muted focus:outline-none
                  text-base font-semibold"
              />
              {showEye && (
                <button
                  type="button"
                  onClick={() => setPinVisible(!pinVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted
                    hover:text-red-main transition-colors duration-200 animate-eye-appear"
                  tabIndex={-1}
                >
                  {pinVisible ? <EyeOpenIcon /> : <EyeClosedIcon />}
                </button>
              )}
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-text-muted text-sm font-black mb-1.5 uppercase tracking-wider">
              Takma Adın
            </label>
            <div className="relative input-icon-group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
                <UserIcon />
              </div>
              <input
                type="text"
                placeholder="Odadaki herkes bu adı görecek"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={24}
                className="w-full pl-11 pr-4 py-3 bg-bg-card cartoon-input
                  text-text-main placeholder-text-muted focus:outline-none
                  text-base font-semibold"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-soft text-base font-bold animate-wobble">
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-3 bg-red-main text-white font-extrabold rounded-2xl
              cartoon-btn hover:bg-red-soft disabled:opacity-50 disabled:cursor-not-allowed
              disabled:transform-none text-base"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Oluşturuluyor...
              </span>
            ) : (
              'Odayı Kur'
            )}
          </button>
        </div>
      )}
    </Modal>
  );
}
