import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { getSession, saveSession, clearSession } from '../lib/session';
import type { PublicRoomState, RoomUser, ChatMessage, SyncTarget } from '../lib/socket';
import YouTubePlayer from '../components/YouTubePlayer';
import ChatPanel from '../components/ChatPanel';
import VideoInputBar from '../components/VideoInputBar';
import UserList from '../components/UserList';
import ShareRoomLink from '../components/ShareRoomLink';

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
      serverTime: number;
      syncTarget: SyncTarget;
    }) => {
      useRoomStore.getState().setRoom(data.room);
      useRoomStore.getState().setCurrentUser(data.user);
      useRoomStore.getState().setUsers(data.users);
      useRoomStore.getState().setChatHistory(data.chatHistory);
      useRoomStore.getState().setServerOffsetMs(data.serverTime - Date.now());

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
      setJoinError(data.message);
      setJoining(false);
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
    }) => {
      useRoomStore.getState().updatePlayback({
        videoId: data.videoId,
        status: data.state.status,
        baseTime: data.state.baseTime,
        baseServerTime: data.state.baseServerTime,
        version: data.state.version,
        updatedBy: (data.state as any).updatedBy ?? null,
      });
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
      addToast(`${data.user.displayName} odaya katıldı.`);
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

      // Update session if it's the current user
      const currentUser = useRoomStore.getState().currentUser;
      if (currentUser && data.userId === currentUser.id) {
        const session = getSession();
        if (session) {
          saveSession({ ...session, role: data.role as RoomUser['role'] });
        }
      }
    };

    const handleDisconnect = () => {
      if (joined) {
        addToast('Sunucu bağlantısı kesildi. Yeniden bağlanılıyor...', 'warning');
      }
    };

    socket.on('room:joined', handleRoomJoined);
    socket.on('room:error', handleRoomError);
    socket.on('room:users:update', handleUsersUpdate);
    socket.on('playback:state', handlePlaybackState);
    socket.on('video:changed', handleVideoChanged);
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

  const handleJoin = () => {
    if (!displayName.trim()) {
      setJoinError('Görünen adınızı girin.');
      return;
    }
    if (!pin.trim()) {
      setJoinError('PIN girin.');
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
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-muted text-sm">Oturum kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  // --- PIN Step ---
  if (pinStep) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-bg-panel border border-white/10 rounded-2xl p-6 animate-fade-in">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-red-main/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-red-main" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-text-main">Odaya Katıl</h2>
            <p className="text-text-muted text-sm mt-1">Görünen adını ve PIN'i gir</p>
          </div>

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
                transition-colors"
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
                transition-colors"
            />
            {joinError && (
              <p className="text-red-soft text-sm">{joinError}</p>
            )}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full py-3 bg-red-main text-white font-semibold rounded-xl
                glow-red-sm hover:glow-red transition-all duration-300
                hover:bg-red-soft active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joining ? 'Katılıyor...' : 'Katıl'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full py-2 text-text-muted hover:text-text-main text-sm transition-colors"
            >
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
        <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main">
      {/* Top Bar */}
      <header className="border-b border-white/5 bg-bg-panel/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                getSocket().emit('room:leave');
                reset();
                navigate('/');
              }}
              className="text-text-muted hover:text-text-main transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-text-main truncate">{room.name}</h2>
            <span className="text-xs bg-bg-card text-text-muted px-2 py-1 rounded-lg border border-white/5">
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

            {/* Player */}
            <div className="relative bg-black rounded-2xl overflow-hidden border border-white/5 aspect-video">
              <YouTubePlayer videoId={room.playback.videoId} />
              {!room.playback.videoId && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center">
                    <div className="text-5xl mb-4">🎥</div>
                    <p className="text-text-muted text-lg">Henüz video eklenmedi.</p>
                    <p className="text-text-muted/60 text-sm mt-1">
                      Admin bir YouTube linki yapıştırdığında video burada görünecek.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* User List */}
            <div className="mt-3">
              <UserList />
            </div>
          </div>

          {/* Chat Panel */}
          <div className="w-full lg:w-80 xl:w-96 shrink-0">
            <ChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
