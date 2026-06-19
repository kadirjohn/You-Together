import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import { saveSession } from '../lib/session';
import Modal from './ui/Modal';

/* ── Inline SVG Icons ── */
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

export default function JoinRoomModal() {
  const navigate = useNavigate();
  const { showJoinModal, joinRoomId, closeJoinModal, addToast } = useUIStore();

  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pinVisible, setPinVisible] = useState(true);
  const [showEye, setShowEye] = useState(false);

  if (!showJoinModal || !joinRoomId) return null;

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

  const handleJoin = () => {
    setError('');
    if (!displayName.trim()) {
      setError('Takma adını gir.');
      return;
    }
    if (!pin.trim()) {
      setError('PIN gir.');
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
    <Modal open={true} onClose={closeJoinModal} title="🚪 Odaya Katıl">
      <div className="space-y-3">
        {/* Display Name */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <UserIcon />
          </div>
          <input
            type="text"
            placeholder="Takma adın"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={24}
            className="w-full pl-11 pr-4 py-3 bg-bg-card cartoon-input
              text-text-main placeholder-text-muted focus:outline-none
              text-sm font-semibold"
            autoFocus
          />
        </div>

        {/* PIN */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <LockIcon />
          </div>
          <input
            type={pinVisible ? 'text' : 'password'}
            placeholder="PIN"
            value={pin}
            onChange={handlePinChange}
            onKeyDown={handleKeyDown}
            maxLength={12}
            className="w-full pl-11 pr-12 py-3 bg-bg-card cartoon-input
              text-text-main placeholder-text-muted focus:outline-none
              text-sm font-semibold"
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

        {error && (
          <div className="flex items-center gap-2 text-red-soft text-sm font-bold animate-wobble">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
            {error}
          </div>
        )}
        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-3 bg-red-main text-white font-extrabold rounded-2xl
            cartoon-btn hover:bg-red-soft disabled:opacity-50 disabled:cursor-not-allowed
            disabled:transform-none text-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Katılıyor...
            </span>
          ) : (
            'Katıl! 🎬'
          )}
        </button>
      </div>
    </Modal>
  );
}
