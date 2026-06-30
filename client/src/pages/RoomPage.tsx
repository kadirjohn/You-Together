import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { getSession, saveSession, clearSession } from '../lib/session';
import type { PublicRoomState, RoomUser, ChatMessage, SyncTarget, VideoMeta, WatchedVideo, PlaylistItem } from '../lib/socket';
import YouTubePlayer, { SyncBadge } from '../components/YouTubePlayer';
import HtmlPlayer from '../components/HtmlPlayer';
import ChatPanel from '../components/ChatPanel';
import VideoInputBar from '../components/VideoInputBar';
import UserList from '../components/UserList';
import ShareRoomLink from '../components/ShareRoomLink';
import WatchList from '../components/WatchList';
import PlaylistPanel from '../components/PlaylistPanel';
import PlaybackControls from '../components/PlaybackControls';

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

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useRoomStore((s) => s.room);
  const reset = useRoomStore((s) => s.reset);
  const { addToast } = useUIStore();

  const [pinStep, setPinStep] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true); // new: session check loading
  const [pinVisible, setPinVisible] = useState(true);
  const [showEye, setShowEye] = useState(false);

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

  // --- Auto-rejoin: check localStorage session on mount ---
  useEffect(() => {
    if (!roomId) return;

    const session = getSession();
    if (session && session.roomId === roomId) {
      // We have a session for this room — try auto-rejoin without PIN
      const socket = getSocket();

      // Declare timeout before handlers so both can clear it
      let rejoinTimeout: ReturnType<typeof setTimeout>;

      const handleRejoinSuccess = (data: {
        room: PublicRoomState;
        user: RoomUser;
        users: RoomUser[];
        chatHistory: ChatMessage[];
        watchlist?: WatchedVideo[];
        playlist?: PlaylistItem[];
        meta?: VideoMeta | null;
        serverTime: number;
        syncTarget: SyncTarget;
      }) => {
        clearTimeout(rejoinTimeout);
        socket.off('room:joined', handleRejoinSuccess);
        socket.off('room:error', handleRejoinFail);
        useRoomStore.getState().setRoom(data.room);
        useRoomStore.getState().setCurrentUser(data.user);
        useRoomStore.getState().setUsers(data.users);
        useRoomStore.getState().setChatHistory(data.chatHistory);
        useRoomStore.getState().setWatchlist(data.watchlist ?? []);
        useRoomStore.getState().setPlaylist(data.playlist ?? []);
        useRoomStore.getState().setMeta(data.meta ?? null);
        useRoomStore.getState().setServerOffsetMs(data.serverTime - Date.now());
        // Update session displayName in case it changed
        saveSession({ ...session, displayName: data.user.displayName, role: data.user.role });
        setJoined(true);
        setPinStep(false);
        setCheckingSession(false);
      };

      const handleRejoinFail = () => {
        clearTimeout(rejoinTimeout);
        socket.off('room:joined', handleRejoinSuccess);
        socket.off('room:error', handleRejoinFail);
        // Session is stale — clear it and fall back to PIN screen
        clearSession();
        setCheckingSession(false);
      };

      socket.on('room:joined', handleRejoinSuccess);
      socket.on('room:error', handleRejoinFail);

      socket.emit('room:rejoin', {
        roomId,
        userId: session.userId,
        displayName: session.displayName,
      });

      // Timeout: if server doesn't respond in 5s, fallback to PIN
      rejoinTimeout = setTimeout(() => {
        socket.off('room:joined', handleRejoinSuccess);
        socket.off('room:error', handleRejoinFail);
        clearSession();
        setCheckingSession(false);
      }, 5000);

      return () => {
        clearTimeout(rejoinTimeout);
        socket.off('room:joined', handleRejoinSuccess);
        socket.off('room:error', handleRejoinFail);
      };
    } else {
      // No session — go straight to PIN screen
      setCheckingSession(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    const socket = getSocket();

    const handleRoomJoined = (data: {
      room: PublicRoomState;
      user: RoomUser;
      users: RoomUser[];
      chatHistory: ChatMessage[];
      watchlist?: WatchedVideo[];
      playlist?: PlaylistItem[];
      meta?: VideoMeta | null;
      serverTime: number;
      syncTarget: SyncTarget;
    }) => {
      useRoomStore.getState().setRoom(data.room);
      useRoomStore.getState().setCurrentUser(data.user);
      useRoomStore.getState().setUsers(data.users);
      useRoomStore.getState().setChatHistory(data.chatHistory);
      useRoomStore.getState().setWatchlist(data.watchlist ?? []);
      useRoomStore.getState().setPlaylist(data.playlist ?? []);
      useRoomStore.getState().setMeta(data.meta ?? null);
      useRoomStore.getState().setServerOffsetMs(data.serverTime - Date.now());

      // Senkron state'i başlat (geç katılan / sayfa yenileme). syncTarget
      // doğru hedef konumu taşır; player onReady'de buraya seek eder.
      useRoomStore.getState().setRoomPlaybackStatus(
        data.syncTarget.status === 'playing' ? 'playing' : data.syncTarget.status === 'paused' ? 'paused' : 'idle',
      );
      useRoomStore.getState().setAdminUserId(data.room.playback.updatedBy ?? null);
      // Yeni (re)join → tsMap temiz başla (eski odanın stale konumları yok).
      useRoomStore.getState().setTsMap({});

      // Save session so this browser remembers the user
      saveSession({
        roomId: roomId!,
        userId: data.user.id,
        displayName: data.user.displayName,
        role: data.user.role,
        joinedAt: data.user.joinedAt,
      });

      setJoined(true);
      setPinStep(false);
      setJoinError('');
      setJoining(false);
    };

    const handleRoomError = (data: { message: string }) => {
      // Join akışı: PIN ekranında hata yazısı olarak göster.
      setJoinError(data.message);
      setJoining(false);
      // Katılmış kullanıcı: oda-içi işlemlerden gelen hataları (ör. member pause
      // reddedildiğinde "Sadece admin...") toast olarak göster — joinError state'i
      // artık görünür değil.
      if (useRoomStore.getState().currentUser) {
        addToast(data.message, 'warning');
      }
    };

    const handleUsersUpdate = (users: RoomUser[]) => {
      useRoomStore.getState().setUsers(users);
    };

    const handlePlaybackState = (data: {
      status: string;
      baseTime: number;
      baseServerTime: number;
      version: number;
      updatedBy: string;
      clientEventId?: string;
      serverTime: number;
    }) => {
      useRoomStore.getState().setServerOffsetMs(data.serverTime - Date.now());
      useRoomStore.getState().updatePlayback({
        status: data.status,
        baseTime: data.baseTime,
        baseServerTime: data.baseServerTime,
        version: data.version,
        updatedBy: data.updatedBy,
      });
      useRoomStore.getState().setLastRemoteVersion(data.version);
      // Bounce guard için oda-authoritative playback durumunu güncelle.
      // (Player bunu onStateChange echo'larını bastırmak için kullanır.)
      useRoomStore.getState().setRoomPlaybackStatus(
        data.status === 'playing' ? 'playing' : data.status === 'paused' ? 'paused' : 'idle',
      );
      // Admin değişikliği geldiğinde updatedBy = lider; tsMap leader çözümü için sakla.
      useRoomStore.getState().setAdminUserId(data.updatedBy ?? null);
    };

    const handleVideoChanged = (data: {
      videoId: string;
      state: {
        videoId: string | null;
        status: string;
        baseTime: number;
        baseServerTime: number;
        version: number;
      };
      meta?: VideoMeta | null;
    }) => {
      useRoomStore.getState().updatePlayback({
        videoId: data.videoId,
        status: data.state.status,
        baseTime: data.state.baseTime,
        baseServerTime: data.state.baseServerTime,
        version: data.state.version,
        updatedBy: (data.state as any).updatedBy ?? null,
      });
      // Sunucudan gelen yeni videonun metası (süre + başlık + kanal).
      useRoomStore.getState().setMeta(data.meta ?? null);
      // Yeni video → eski tsMap'i temizle (stale konumlar gelmesin).
      useRoomStore.getState().setTsMap({});
      useRoomStore.getState().setRoomPlaybackStatus(
        data.state.status === 'playing' ? 'playing' : data.state.status === 'paused' ? 'paused' : 'idle',
      );
      useRoomStore.getState().setAdminUserId((data.state as any).updatedBy ?? null);
    };

    const handleVideoWatchlist = (videos: WatchedVideo[]) => {
      useRoomStore.getState().setWatchlist(videos);
    };

    const handlePlaylistUpdate = (playlist: PlaylistItem[]) => {
      useRoomStore.getState().setPlaylist(playlist);
    };

    const handleMediaChanged = (data: {
      mediaType: 'mp4' | 'hls';
      mediaUrl: string;
      state: {
        mediaType: 'mp4' | 'hls';
        mediaUrl: string | null;
        status: string;
        baseTime: number;
        baseServerTime: number;
        version: number;
        updatedBy: string | null;
      };
    }) => {
      useRoomStore.getState().updatePlayback({
        videoId: null,
        mediaType: data.mediaType,
        mediaUrl: data.mediaUrl,
        status: data.state.status,
        baseTime: data.state.baseTime,
        baseServerTime: data.state.baseServerTime,
        version: data.state.version,
        updatedBy: data.state.updatedBy,
      });
      useRoomStore.getState().setMeta(null);
      useRoomStore.getState().setTsMap({});
      useRoomStore.getState().setRoomPlaybackStatus(
        data.state.status === 'playing' ? 'playing' : data.state.status === 'paused' ? 'paused' : 'idle',
      );
      useRoomStore.getState().setAdminUserId(data.state.updatedBy ?? null);
    };

    const handlePlaybackRate = (data: { rate: number }) => {
      useRoomStore.getState().updatePlayback({ playbackRate: data.rate });
    };

    const handlePlaybackLoop = (data: { loop: boolean }) => {
      useRoomStore.getState().updatePlayback({ loop: data.loop });
    };

    // Sunucudan per-izleyici GERÇEK konum haritası (her 1 sn). Player drift
    // düzeltme bunu kullanır. Store'a yazmak yeterli — player listener'ı
    // YouTubePlayer.tsx içindeki playback:tsmap handler'da drift'i uygular.
    const handleTsMap = (data: { tsMap: Record<string, number>; adminUserId: string | null }) => {
      useRoomStore.getState().setTsMap(data.tsMap);
      if (data.adminUserId) useRoomStore.getState().setAdminUserId(data.adminUserId);
    };

    const handleChatMessage = (msg: ChatMessage) => {
      useRoomStore.getState().addChatMessage(msg);
    };

    const handleSystemMessage = (msg: { id: string; text: string; createdAt: number }) => {
      const systemMsg: ChatMessage = {
        id: msg.id,
        roomId: roomId || '',
        userId: 'system',
        displayName: 'Sistem',
        role: 'member',
        text: msg.text,
        createdAt: msg.createdAt,
      };
      useRoomStore.getState().addChatMessage(systemMsg);
    };

    const handleUserJoined = (data: { user: RoomUser }) => {
      addToast(`${data.user.displayName} odaya katıldı`);
    };

    const handleUserLeft = (data: { userId: string }) => {
      const users = useRoomStore.getState().users;
      const user = users.find((u) => u.id === data.userId);
      if (user) {
        addToast(`${user.displayName} odadan ayrıldı.`);
      }
    };

    const handleAdminUpdated = (data: { userId: string; role: string }) => {
      const users = useRoomStore.getState().users;
      const updated = users.map((u) =>
        u.id === data.userId ? { ...u, role: data.role as RoomUser['role'] } : u,
      );
      useRoomStore.getState().setUsers(updated);

      // Update currentUser + session if it's the current user.
      // setCurrentUser şart — yoksa promosyon/demosyon alan kullanıcının isAdmin
      // değeri (YouTubePlayer'da rol bazlı emit gate'i + UserList buton gate'i)
      // sayfa yeniden yüklenene kadar eski kalır.
      const currentUser = useRoomStore.getState().currentUser;
      if (currentUser && data.userId === currentUser.id) {
        useRoomStore.getState().setCurrentUser({ ...currentUser, role: data.role as RoomUser['role'] });
        const session = getSession();
        if (session) {
          saveSession({ ...session, role: data.role as RoomUser['role'] });
        }
      }
    };

    const handleDisconnect = () => {
      if (joined) {
        addToast('Bağlantı kesildi, yeniden bağlanılıyor', 'warning');
      }
    };

    socket.on('room:joined', handleRoomJoined);
    socket.on('room:error', handleRoomError);
    socket.on('room:users:update', handleUsersUpdate);
    socket.on('playback:state', handlePlaybackState);
    socket.on('video:changed', handleVideoChanged);
    socket.on('video:watchlist', handleVideoWatchlist);
    socket.on('playlist:update', handlePlaylistUpdate);
    socket.on('media:changed', handleMediaChanged);
    socket.on('playback:rate', handlePlaybackRate);
    socket.on('playback:loop', handlePlaybackLoop);
    socket.on('playback:tsmap', handleTsMap);
    socket.on('chat:message', handleChatMessage);
    socket.on('system:message', handleSystemMessage);
    socket.on('user:joined', handleUserJoined);
    socket.on('user:left', handleUserLeft);
    socket.on('admin:updated', handleAdminUpdated);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('room:joined', handleRoomJoined);
      socket.off('room:error', handleRoomError);
      socket.off('room:users:update', handleUsersUpdate);
      socket.off('playback:state', handlePlaybackState);
      socket.off('video:changed', handleVideoChanged);
      socket.off('video:watchlist', handleVideoWatchlist);
      socket.off('playlist:update', handlePlaylistUpdate);
      socket.off('media:changed', handleMediaChanged);
      socket.off('playback:rate', handlePlaybackRate);
      socket.off('playback:loop', handlePlaybackLoop);
      socket.off('playback:tsmap', handleTsMap);
      socket.off('chat:message', handleChatMessage);
      socket.off('system:message', handleSystemMessage);
      socket.off('user:joined', handleUserJoined);
      socket.off('user:left', handleUserLeft);
      socket.off('admin:updated', handleAdminUpdated);
      socket.off('disconnect', handleDisconnect);

      // Do NOT emit room:leave on unmount (page refresh / navigate).
      // Server disconnect handler gives 30s grace period for rejoin.
      // Session is kept in localStorage so the user can auto-rejoin.
      // Only explicit "back" button click emits room:leave.
    };
  }, [roomId]);

  // --- Klavye kısayolları (input/textarea focus değilken) ---
  // space: admin toggle play, ArrowRight/Left: ±10s (admin seek emit),
  // f: fullscreen toggle (player container), m: mute (yerel, broadcast değil).
  useEffect(() => {
    if (!joined) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement)?.isContentEditable) return;
      const state = useRoomStore.getState();
      const room = state.room;
      if (!room) return;
      const isAdmin = state.currentUser?.role === 'owner' || state.currentUser?.role === 'admin';
      const socket = getSocket();
      const eid = () => `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (e.key === ' ') {
        e.preventDefault();
        if (isAdmin) {
          const playing = state.roomPlaybackStatus === 'playing';
          if (playing) {
            socket.emit('playback:pause', { roomId: room.id, currentTime: 0, clientEventId: eid() });
          } else {
            socket.emit('playback:play', { roomId: room.id, currentTime: 0, clientEventId: eid() });
          }
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const container = document.querySelector('.aspect-video') as HTMLElement | null;
        if (container) {
          if (document.fullscreenElement) document.exitFullscreen();
          else container.requestFullscreen?.();
        }
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        // Mute toggle: video elementini bul
        const video = document.querySelector('video') as HTMLVideoElement | null;
        if (video) video.muted = !video.muted;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [joined]);

  const handleJoin = () => {
    if (!displayName.trim()) {
      setJoinError('Takma adını gir.');
      return;
    }
    if (!pin.trim()) {
      setJoinError('PIN gir.');
      return;
    }
    setJoining(true);
    setJoinError('');
    getSocket().emit('room:join', {
      roomId: roomId!,
      pin: pin.trim(),
      displayName: displayName.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleJoin();
  };

  // --- Session check loading ---
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center">
        <div className="text-center animate-pop-in">
          <div className="w-10 h-10 border-[3px] border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-muted text-sm font-bold">Oturum kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  // --- PIN Step ---
  if (pinStep) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-bg-panel border-[3px] border-white/10 rounded-3xl p-6 animate-pop-in shadow-cartoon-card">
          <div className="text-center mb-6">
            <img
              src="/ytogether_logo.png"
              alt="You Together"
              className="w-16 h-16 mx-auto rounded-2xl object-contain mb-3 animate-float
                drop-shadow-[0_0_16px_rgba(255,0,51,0.3)]"
            />
            <h2 className="text-3xl font-black text-text-main">Odaya Katıl</h2>
            <p className="text-text-muted text-base mt-2 font-bold">Takma adını ve PIN'i gir</p>
          </div>

          <div className="space-y-4">
            {/* Display Name */}
            <div className="relative input-icon-group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
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
                  text-base font-semibold"
                autoFocus
              />
            </div>

            {/* PIN */}
            <div className="relative input-icon-group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none input-icon z-10">
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

            {joinError && (
              <div className="flex items-center gap-2 text-red-soft text-base font-bold animate-wobble">
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                </svg>
                {joinError}
              </div>
            )}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full py-3 bg-red-main text-white font-extrabold rounded-2xl
                cartoon-btn hover:bg-red-soft disabled:opacity-50 disabled:cursor-not-allowed
                disabled:transform-none text-base"
            >
              {joining ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Katılıyor...
                </span>
              ) : (
                'Katıl'
              )}
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full py-2 text-text-muted hover:text-red-main text-lg font-bold transition-all duration-200
                hover:translate-x-[-2px] flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Ana Sayfaya Dön
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Room View ---
  if (!room || !joined) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center">
        <div className="w-10 h-10 border-[3px] border-red-main border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main">
      {/* Top Bar */}
      <header className="border-b-[3px] border-white/5 bg-bg-panel/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                getSocket().emit('room:leave');
                reset();
                navigate('/');
              }}
              className="w-8 h-8 rounded-xl bg-bg-card border-2 border-white/10 flex items-center justify-center
                text-text-muted hover:text-red-main hover:border-red-main/30
                transition-all duration-200 shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <img
              src="/ytogether_logo.png"
              alt="You Together"
              className="w-8 h-8 rounded-lg object-contain shrink-0 hidden sm:block"
            />
            <h2 className="text-lg font-extrabold text-text-main truncate">{room.name}</h2>
            <span className="text-xs bg-bg-card text-text-muted px-2.5 py-1 rounded-xl border-2 border-white/5 font-bold shrink-0">
              {room.userCount}/{room.maxUsers}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ShareRoomLink roomId={room.id} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1400px] mx-auto p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Video Area */}
          <div className="flex-1 min-w-0">
            {/* Admin Video Input */}
            <VideoInputBar />

            {/* Senkron badge — player'ın hemen üstünde, sağa yaslı.
                Player içinde değil ki native tuşları (kalite/altyazı/fullscreen)
                engellemesin. */}
            <div className="flex justify-end mb-2 min-h-[28px]">
              <SyncBadge />
            </div>

            {/* Player */}
            <div className="relative bg-black rounded-3xl overflow-hidden border-[3px] border-white/5 aspect-video shadow-cartoon-card">
              {room.playback.mediaType === 'youtube' && (
                <YouTubePlayer videoId={room.playback.videoId} />
              )}
              {(room.playback.mediaType === 'mp4' || room.playback.mediaType === 'hls') && room.playback.mediaUrl && (
                <HtmlPlayer
                  mediaType={room.playback.mediaType}
                  mediaUrl={room.playback.mediaUrl}
                />
              )}
              {!room.playback.mediaType && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center animate-bounce-in">
                    <div className="flex justify-center mb-4 animate-float">
                      <svg className="w-16 h-16 text-red-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <path d="M10 12l4-2.5v5L10 12z" />
                      </svg>
                    </div>
                    <p className="text-text-muted text-lg font-bold">Henüz video eklenmedi</p>
                  </div>
                </div>
              )}
            </div>

            {/* Admin Playback Controls (rate / loop / subtitle) — video altında */}
            <div className="mt-3">
              <PlaybackControls />
            </div>

            {/* User List */}
            <div className="mt-3">
              <UserList />
            </div>
          </div>

          {/* Right Panel — Chat + Watch list tabs */}
          <div className="w-full lg:w-80 xl:w-96 shrink-0">
            <RightPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Right Panel — Sohbet / İzlenenler sekmeli panel
// ============================================================
function RightPanel() {
  const [tab, setTab] = useState<'chat' | 'watchlist' | 'playlist'>('chat');
  const watchlistCount = useRoomStore((s) => s.watchlist.length);
  const playlistCount = useRoomStore((s) => s.playlist.length);

  return (
    <div className="bg-bg-panel border-[3px] border-white/5 rounded-3xl flex flex-col h-[calc(100vh-7rem)] lg:h-[calc(100vh-6rem)] shadow-cartoon-card overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b-[3px] border-white/5">
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 px-3 py-3 flex items-center justify-center gap-1.5 font-extrabold text-xs transition-all duration-200 ${
            tab === 'chat'
              ? 'text-red-main border-b-[3px] border-red-main -mb-[3px] bg-red-main/5'
              : 'text-text-muted hover:text-text-main'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Sohbet
        </button>
        <button
          onClick={() => setTab('playlist')}
          className={`flex-1 px-3 py-3 flex items-center justify-center gap-1.5 font-extrabold text-xs transition-all duration-200 ${
            tab === 'playlist'
              ? 'text-red-main border-b-[3px] border-red-main -mb-[3px] bg-red-main/5'
              : 'text-text-muted hover:text-text-main'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          Playlist
          {playlistCount > 0 && (
            <span className="text-xs bg-bg-card text-text-muted px-2 py-0.5 rounded-lg font-bold border border-white/5">
              {playlistCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('watchlist')}
          className={`flex-1 px-3 py-3 flex items-center justify-center gap-1.5 font-extrabold text-xs transition-all duration-200 ${
            tab === 'watchlist'
              ? 'text-red-main border-b-[3px] border-red-main -mb-[3px] bg-red-main/5'
              : 'text-text-muted hover:text-text-main'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          İzlenenler
          {watchlistCount > 0 && (
            <span className="text-xs bg-bg-card text-text-muted px-2 py-0.5 rounded-lg font-bold border border-white/5">
              {watchlistCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {tab === 'chat' && <ChatPanel embedded />}
        {tab === 'watchlist' && <WatchList />}
        {tab === 'playlist' && <PlaylistPanel />}
      </div>
    </div>
  );
}
