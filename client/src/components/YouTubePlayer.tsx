import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { computeExpectedRoomTime } from '../lib/time';

const YT_ORIGIN = 'https://www.youtube.com';

interface YouTubePlayerProps {
  videoId: string | null;
}

// YouTube iframe embed with custom admin control bar.
// YouTube's postMessage API (onReady, onStateChange, infoDelivery) is unreliable
// on ngrok/localhost — events never arrive. Strategy:
//   1. Custom control bar for admin/owner: Play/Pause toggle + timeline slider + fullscreen
//   2. Own time tracking via 250ms interval (replaces YouTube infoDelivery)
//   3. Admin actions → sendCommand + socket emit → server broadcast → all clients sync
//   4. Initial sync: timeout fallback → sync:request → sync:command (seekTo + play/pause)
//   5. Muted autoplay fallback for browser autoplay policy
//   6. "Oynat" button as last-resort fallback when autoplay is blocked
//   7. controls=0 hides YouTube's own UI — our custom bar replaces it
//   8. Click overlay blocks YouTube's native click-to-play/pause for admin
export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const roomIdRef = useRef<string | undefined>();
  const addToastRef = useRef<(msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void>();
  const commandId = useRef(0);

  // Keep refs in sync with latest store/state values
  const roomIdFromStore = useRoomStore((s) => s.room?.id);
  roomIdRef.current = roomIdFromStore;
  const currentUser = useRoomStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';
  const addToast = useUIStore((s) => s.addToast);
  addToastRef.current = addToast;
  // Sunucu-taraflı video metası (süre + başlık + kanal). Birincil süre kaynağı.
  const meta = useRoomStore((s) => s.meta);

  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [userManuallySeeked, setUserManuallySeeked] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);
  const [uiPlaying, setUiPlaying] = useState(false);
  const [uiTime, setUiTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Player state tracking (all via refs for permanent listener access)
  const playerState = useRef({
    playing: false,
    currentTime: 0,
    lastTimeUpdate: 0,
    muted: false,
  });
  const videoDuration = useRef<number | null>(null);
  const lastLocalTime = useRef(0);
  const lastCheckTime = useRef(Date.now());
  const applyingRemoteUpdate = useRef(false);
  const isRemoteSyncing = useRef(false);
  const initialSyncDone = useRef(false);
  const syncFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenerAttached = useRef(false);
  const timeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoplayRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build embed URL once
  const embedUrl = useMemo(() => {
    if (!videoId) return '';
    const origin = encodeURIComponent(window.location.origin);
    // vq=hd1080 sets default quality to highest available (up to 1080p).
    // Runtime quality change requires postMessage API which is unreliable.
    return `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&origin=${origin}&widget_referrer=${origin}&modestbranding=1&rel=0&iv_load_policy=3&autoplay=0&controls=0&fs=0&vq=hd1080`;
  }, [videoId]);

  // Get live current time (interpolated from our own timer)
  const getLiveTime = useCallback((): number => {
    const ps = playerState.current;
    if (ps.playing && ps.lastTimeUpdate > 0) {
      return ps.currentTime + (Date.now() - ps.lastTimeUpdate) / 1000;
    }
    return ps.currentTime;
  }, []);

  // Send command to iframe via postMessage
  const sendCommand = useCallback((func: string, args: any[] = []) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const id = ++commandId.current;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args, id: `cmd_${id}` }),
      YT_ORIGIN,
    );
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Muted autoplay helper
  const tryMutedAutoplay = useCallback(() => {
    sendCommand('mute');
    playerState.current.muted = true;
    sendCommand('playVideo');
    setTimeout(() => {
      sendCommand('unMute');
      playerState.current.muted = false;
    }, 800);
    playerState.current.playing = true;
    playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true);
    return true;
  }, [sendCommand]);

  // Own time tracking timer
  useEffect(() => {
    if (!playerReady || !videoId) {
      if (timeTimerRef.current) { clearInterval(timeTimerRef.current); timeTimerRef.current = null; }
      return;
    }
    timeTimerRef.current = setInterval(() => {
      if (playerState.current.playing && !applyingRemoteUpdate.current) {
        playerState.current.currentTime += 0.25;
        playerState.current.lastTimeUpdate = Date.now();
      }
      setUiPlaying(playerState.current.playing);
      setUiTime(getLiveTime());
    }, 250);
    return () => { if (timeTimerRef.current) { clearInterval(timeTimerRef.current); timeTimerRef.current = null; } };
  }, [playerReady, videoId]);

  // PERMANENT message listener
  useEffect(() => {
    if (listenerAttached.current) return;
    listenerAttached.current = true;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== YT_ORIGIN) return;
      let data: any;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }

      if (data.event === 'onReady') {
        if (syncFallbackTimer.current) { clearTimeout(syncFallbackTimer.current); syncFallbackTimer.current = null; }
        setPlayerReady(true);
        useRoomStore.getState().setPlayerReady(true);
        setBuffering(false);
        sendCommand('getDuration');
        const storeState = useRoomStore.getState();
        const playback = storeState.room?.playback;
        if (playback?.videoId && playback.baseServerTime > 0) {
          const targetTime = computeExpectedRoomTime(
            { baseTime: playback.baseTime, baseServerTime: playback.baseServerTime, status: playback.status },
            storeState.serverOffsetMs,
          );
          applyingRemoteUpdate.current = true;
          sendCommand('seekTo', [targetTime, true]);
          playerState.current.currentTime = targetTime;
          playerState.current.lastTimeUpdate = Date.now();
          lastLocalTime.current = targetTime;
          lastCheckTime.current = Date.now();
          if (playback.status === 'playing') { tryMutedAutoplay(); }
          else if (playback.status === 'paused') { sendCommand('pauseVideo'); playerState.current.playing = false; }
          setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
        } else {
          playerState.current.currentTime = 0;
          playerState.current.lastTimeUpdate = Date.now();
          lastLocalTime.current = 0;
          lastCheckTime.current = Date.now();
        }
        initialSyncDone.current = true;
        const rid = roomIdRef.current;
        if (rid) getSocket().emit('client:player-ready', { roomId: rid });
        return;
      }

      if (data.event === 'onStateChange') {
        const state = data.info ?? data.data;
        const storeState = useRoomStore.getState();
        if (state === 1) {
          setBuffering(false); setNeedsUserInteraction(false);
          playerState.current.playing = true;
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const rid = roomIdRef.current;
            if (rid) getSocket().emit('playback:play', { roomId: rid, currentTime: getLiveTime(), clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
          }
        } else if (state === 2) {
          playerState.current.playing = false; playerState.current.lastTimeUpdate = Date.now();
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const rid = roomIdRef.current;
            if (rid) getSocket().emit('playback:pause', { roomId: rid, currentTime: getLiveTime(), clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
          }
        } else if (state === 3) {
          setBuffering(true); useRoomStore.getState().setSyncStatus('buffering'); playerState.current.playing = false;
          const rid = roomIdRef.current;
          if (rid) getSocket().emit('client:buffering', { roomId: rid });
        }
        return;
      }

      if (data.event === 'infoDelivery' || data.info?.currentTime !== undefined) {
        const info = data.info ?? data;
        if (typeof info?.currentTime === 'number') { playerState.current.currentTime = info.currentTime; playerState.current.lastTimeUpdate = Date.now(); }
        // Süre: sunucu metası birincil kaynaktır. Sunucu bilmiyorsa (null) postMessage
        // yedek kaynaktır — ngrok/localhost'ta gelmez ama gelirse kullanılır.
        if (videoDuration.current == null && typeof info?.duration === 'number' && info.duration > 0) { videoDuration.current = info.duration; }
        if (typeof info?.muted === 'boolean') { playerState.current.muted = info.muted; }
        if (info?.playerState === 1 || info?.currentTime !== undefined) { setNeedsUserInteraction(false); }
        return;
      }

      if (data.event === 'onError') {
        const errorCode = data.info ?? data.data;
        const toast = addToastRef.current;
        if (!toast) return;
        if (errorCode === 101 || errorCode === 150) toast('Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.', 'error');
        else if (errorCode === 100) toast('Bu video bulunamadı veya kaldırılmış.', 'error');
        else if (errorCode === 5) toast('Video oynatılamadı. YouTube hesabınıza giriş yapıp tekrar deneyin.', 'error');
        else toast('Video yüklenirken bir hata oluştu.', 'error');
        return;
      }
    };

    window.addEventListener('message', handleMessage);
  }, []);

  // Timeout fallback
  useEffect(() => {
    if (!videoId) { setPlayerReady(false); setNeedsUserInteraction(false); initialSyncDone.current = false; return; }
    setPlayerReady(false); setBuffering(false); setNeedsUserInteraction(false); initialSyncDone.current = false;
    playerState.current = { playing: false, currentTime: 0, lastTimeUpdate: 0, muted: false };
    lastLocalTime.current = 0; lastCheckTime.current = Date.now(); videoDuration.current = null;
    if (syncFallbackTimer.current) { clearTimeout(syncFallbackTimer.current); syncFallbackTimer.current = null; }
    syncFallbackTimer.current = setTimeout(() => {
      if (initialSyncDone.current) return;
      const rid = roomIdRef.current;
      if (rid) getSocket().emit('sync:request', { roomId: rid, localTime: 0, playerState: 'desynced' });
      setPlayerReady(true); useRoomStore.getState().setPlayerReady(true); initialSyncDone.current = true;
      sendCommand('getDuration');
    }, 3000);
    return () => { if (syncFallbackTimer.current) { clearTimeout(syncFallbackTimer.current); syncFallbackTimer.current = null; } };
  }, [videoId]);

  // sync:command listener
  useEffect(() => {
    const rid = roomIdFromStore;
    if (!rid) return;
    const socket = getSocket();
    const handleSyncCommand = (data: any) => {
      applyingRemoteUpdate.current = true;
      try {
        if (typeof data.targetTime === 'number') { sendCommand('seekTo', [data.targetTime, true]); playerState.current.currentTime = data.targetTime; playerState.current.lastTimeUpdate = Date.now(); }
        if (data.status === 'playing') { tryMutedAutoplay(); setUiPlaying(true); }
        else if (data.status === 'paused') { sendCommand('pauseVideo'); playerState.current.playing = false; setUiPlaying(false); setNeedsUserInteraction(false); }
        useRoomStore.getState().setLastRemoteVersion(data.version || 0);
        setUserManuallySeeked(false);
        lastLocalTime.current = playerState.current.currentTime;
        lastCheckTime.current = Date.now();
      } finally { setTimeout(() => { applyingRemoteUpdate.current = false; }, 500); }
    };
    socket.on('sync:command', handleSyncCommand);
    return () => { socket.off('sync:command', handleSyncCommand); };
  }, [roomIdFromStore, sendCommand, tryMutedAutoplay]);

  // Drift sync loop
  useEffect(() => {
    if (!playerReady || !roomIdFromStore) return;
    let tickCount = 0;
    const interval = setInterval(() => {
      const state = useRoomStore.getState();
      if (!state.room?.playback.videoId) return;
      if (applyingRemoteUpdate.current) return;
      const localTime = getLiveTime();
      const now = Date.now();
      const elapsed = (now - lastCheckTime.current) / 1000;
      const expectedLocal = lastLocalTime.current + (playerState.current.playing ? elapsed : 0);
      const jump = Math.abs(localTime - expectedLocal);
      if (jump > 3 && lastLocalTime.current > 0 && !isRemoteSyncing.current) { setUserManuallySeeked(true); }
      lastLocalTime.current = localTime; lastCheckTime.current = now;
      tickCount++;
      if (tickCount % 2 !== 0) return;
      if (userManuallySeeked) { useRoomStore.getState().setSyncStatus('slightly-off'); return; }
      const expectedTime = computeExpectedRoomTime(
        { baseTime: state.room.playback.baseTime, baseServerTime: state.room.playback.baseServerTime, status: state.room.playback.status },
        state.serverOffsetMs,
      );
      const drift = localTime - expectedTime;
      const absDrift = Math.abs(drift);
      if (absDrift <= 1.5) { useRoomStore.getState().setSyncStatus('synced'); return; }
      if (absDrift <= 2.5) { useRoomStore.getState().setSyncStatus('slightly-off'); return; }
      if (absDrift <= 3) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
        sendCommand('seekTo', [expectedTime, true]);
        playerState.current.currentTime = expectedTime; playerState.current.lastTimeUpdate = Date.now();
        lastLocalTime.current = expectedTime; lastCheckTime.current = Date.now();
        setTimeout(() => { applyingRemoteUpdate.current = false; isRemoteSyncing.current = false; }, 1500);
        return;
      }
      useRoomStore.getState().setSyncStatus('resyncing');
      isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
      sendCommand('seekTo', [expectedTime, true]);
      playerState.current.currentTime = expectedTime; playerState.current.lastTimeUpdate = Date.now();
      lastLocalTime.current = expectedTime; lastCheckTime.current = Date.now();
      const toast = addToastRef.current;
      if (toast) toast('En son kaldığın yerden devam ediliyor.', 'info');
      setTimeout(() => { applyingRemoteUpdate.current = false; isRemoteSyncing.current = false; }, 1500);
    }, 1000);
    return () => clearInterval(interval);
  }, [playerReady, roomIdFromStore, userManuallySeeked, sendCommand, getLiveTime]);

  // Version watch
  const playbackVersion = useRoomStore((s) => s.room?.playback.version ?? 0);
  // Sunucu metası → videoDuration. Sunucu süresi birincil kaynak; postMessage yedek.
  // meta değişince (yeni video / güncellenmiş meta) videoDuration güncellenir.
  useEffect(() => {
    if (!meta) return;
    if (meta.videoId === useRoomStore.getState().room?.playback.videoId) {
      if (typeof meta.durationSeconds === 'number' && meta.durationSeconds > 0) {
        videoDuration.current = meta.durationSeconds;
      }
    }
  }, [meta]);
  useEffect(() => {
    if (!playerReady || !roomIdFromStore || playbackVersion === 0) return;
    const state = useRoomStore.getState();
    const playback = state.room?.playback;
    if (!playback?.videoId || playback.baseServerTime <= 0) return;
    const myUserId = state.currentUser?.id;
    if (myUserId && playback.updatedBy === myUserId) return;
    const targetTime = computeExpectedRoomTime(
      { baseTime: playback.baseTime, baseServerTime: playback.baseServerTime, status: playback.status },
      state.serverOffsetMs,
    );
    isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
    sendCommand('seekTo', [targetTime, true]);
    playerState.current.currentTime = targetTime; playerState.current.lastTimeUpdate = Date.now();
    lastLocalTime.current = targetTime; lastCheckTime.current = Date.now();
    if (playback.status === 'playing') {
      tryMutedAutoplay(); setUiPlaying(true);
      if (autoplayRetryTimer.current) clearTimeout(autoplayRetryTimer.current);
      autoplayRetryTimer.current = setTimeout(() => { if (!playerState.current.playing) setNeedsUserInteraction(true); }, 2000);
    } else if (playback.status === 'paused') {
      sendCommand('pauseVideo'); playerState.current.playing = false; setUiPlaying(false); setNeedsUserInteraction(false);
    }
    setUserManuallySeeked(false);
    setTimeout(() => { applyingRemoteUpdate.current = false; isRemoteSyncing.current = false; }, 1500);
  }, [playbackVersion]);

  // Admin control handlers
  const handleAdminPlay = useCallback(() => {
    const rid = roomIdRef.current; if (!rid) return;
    const time = getLiveTime();
    applyingRemoteUpdate.current = true;
    sendCommand('playVideo');
    playerState.current.playing = true; playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true); setNeedsUserInteraction(false);
    getSocket().emit('playback:play', { roomId: rid, currentTime: time, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand, getLiveTime]);

  const handleAdminPause = useCallback(() => {
    const rid = roomIdRef.current; if (!rid) return;
    const time = getLiveTime();
    applyingRemoteUpdate.current = true;
    sendCommand('pauseVideo');
    playerState.current.playing = false; playerState.current.currentTime = time; playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(false); setUiTime(time);
    getSocket().emit('playback:pause', { roomId: rid, currentTime: time, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand, getLiveTime]);

  const handleAdminSeek = useCallback((targetTime: number) => {
    const rid = roomIdRef.current; if (!rid) return;
    applyingRemoteUpdate.current = true;
    sendCommand('seekTo', [targetTime, true]);
    sendCommand('playVideo');
    playerState.current.currentTime = targetTime; playerState.current.lastTimeUpdate = Date.now();
    playerState.current.playing = true;
    lastLocalTime.current = targetTime; lastCheckTime.current = Date.now();
    setUiPlaying(true); setUiTime(targetTime); setNeedsUserInteraction(false);
    getSocket().emit('playback:seek', { roomId: rid, targetTime, shouldPlay: true, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand]);

  const handleRejoinRoom = useCallback(() => {
    const rid = roomIdRef.current; if (!rid) return;
    applyingRemoteUpdate.current = true;
    getSocket().emit('sync:request', { roomId: rid, localTime: getLiveTime(), playerState: 'desynced' });
    setTimeout(() => { applyingRemoteUpdate.current = false; setUserManuallySeeked(false); }, 1000);
  }, [getLiveTime]);

  const handleUserPlay = useCallback(() => {
    sendCommand('playVideo');
    playerState.current.playing = true; playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true); setNeedsUserInteraction(false);
  }, [sendCommand]);

  if (!videoId || !embedUrl) return null;

  const isPlaying = uiPlaying;
  const displayTime = uiTime;

  return (
    <div ref={containerRef} className="relative w-full h-full group">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen"
        title="YouTube video player"
      />

      {/* Click overlay — blocks YouTube's native click-to-play/pause for admin.
          Captures all clicks so iframe never receives them.
          Our buttons (higher z-index + pointer-events-auto) still work. */}
      {isAdmin && (
        <div className="absolute inset-0 z-5" />
      )}

      {/* Buffering overlay */}
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

      {/* "Oynat" button — shown when autoplay is blocked */}
      {needsUserInteraction && !buffering && playerReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-20">
          <button
            onClick={handleUserPlay}
            className="pointer-events-auto px-8 py-4 bg-red-main text-white font-bold text-lg rounded-2xl
              glow-red hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-[0.98] shadow-xl flex items-center gap-3"
          >
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            Videoyu Oynat
          </button>
        </div>
      )}

      {/* Manual seek rejoin button */}
      {userManuallySeeked && !buffering && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 animate-fade-in">
          <button onClick={handleRejoinRoom}
            className="pointer-events-auto px-5 py-3 bg-red-main text-white font-semibold rounded-xl
              glow-red hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-[0.98] shadow-lg flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Beraber izlemeye devam et
          </button>
        </div>
      )}

      {/* Sync badge */}
      <SyncBadge />

      {/* Center play/pause overlay — large button for admin, hover to reveal */}
      {isAdmin && playerReady && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center z-15 pointer-events-none">
          <button
            onClick={isPlaying ? handleAdminPause : handleAdminPlay}
            className="pointer-events-auto w-16 h-16 flex items-center justify-center rounded-full
              bg-black/40 hover:bg-black/60 backdrop-blur-md transition-all duration-200
              text-white opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100
              shadow-[0_0_20px_rgba(255,255,255,0.25)] hover:shadow-[0_0_30px_rgba(255,255,255,0.4)]"
            title={isPlaying ? 'Durdur' : 'Oynat'}
          >
            {isPlaying ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            ) : (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
        </div>
      )}

      {/* Admin control bar — always visible for owner/admin */}
      {isAdmin && playerReady && (
        <AdminControlBar
          isPlaying={isPlaying}
          currentTime={displayTime}
          duration={videoDuration.current}
          isFullscreen={isFullscreen}
          onPlay={handleAdminPlay}
          onPause={handleAdminPause}
          onSeek={handleAdminSeek}
          onToggleFullscreen={toggleFullscreen}
        />
      )}

      {/* Member progress bar — salt-okunur, yalnızca gösterim (Bölüm 3.3) */}
      {!isAdmin && playerReady && (
        <MemberProgressBar currentTime={displayTime} duration={videoDuration.current} />
      )}
    </div>
  );
}

// ============================================================
// Admin Control Bar — Play/Pause + slider + fullscreen + time tooltip
// ============================================================
function AdminControlBar({
  isPlaying, currentTime, duration, isFullscreen,
  onPlay, onPause, onSeek, onToggleFullscreen,
}: {
  isPlaying: boolean; currentTime: number; duration: number | null; isFullscreen: boolean;
  onPlay: () => void; onPause: () => void; onSeek: (time: number) => void; onToggleFullscreen: () => void;
}) {
  const [sliderValue, setSliderValue] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const sliderRef = useRef<HTMLInputElement>(null);
  const draggingValueRef = useRef(0);

  useEffect(() => { if (!isDragging) setSliderValue(currentTime); }, [currentTime, isDragging]);

  const formatTime = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Süre biliniyorsa onu kullan; bilinmiyorsa akıllı fallback (sabit 120dk değil):
  // akışkan timeline için currentTime + 60 (min 300). Süre gelince slider max güncellenir.
  const sliderMax = duration && duration > 0 ? duration : Math.max(currentTime + 60, 300);
  const durationKnown = duration != null && duration > 0;

  const getSliderTimeFromEvent = (e: React.MouseEvent | React.TouchEvent): number => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * sliderMax;
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSliderValue(val); draggingValueRef.current = val;
  };

  const handleSliderMouseMove = (e: React.MouseEvent) => {
    const t = getSliderTimeFromEvent(e);
    setHoverTime(t);
    setHoverX('touches' in e ? 0 : e.clientX);
  };

  const handleSliderMouseLeave = () => { setHoverTime(null); };

  const handleSliderDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const t = getSliderTimeFromEvent(e);
    setSliderValue(t); draggingValueRef.current = t;
  };

  const handleSliderUp = () => {
    setIsDragging(false);
    onSeek(draggingValueRef.current);
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-auto
      bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 py-3 opacity-100">
      {/* Timeline slider with time tooltip */}
      <div className="relative mb-2">
        {/* Time preview tooltip */}
        {hoverTime !== null && !isDragging && (
          <div
            className="absolute bottom-full mb-2 -translate-x-1/2 px-2 py-1 bg-black/80 text-white text-xs rounded-md font-mono whitespace-nowrap pointer-events-none"
            style={{ left: `${((hoverTime / sliderMax) * 100).toFixed(1)}%` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
        <input
          ref={sliderRef}
          type="range" min={0} max={sliderMax} step={0.5}
          value={sliderValue}
          onChange={handleSliderChange}
          onMouseDown={handleSliderDown}
          onMouseUp={handleSliderUp}
          onMouseMove={handleSliderMouseMove}
          onMouseLeave={handleSliderMouseLeave}
          onTouchStart={handleSliderDown}
          onTouchEnd={handleSliderUp}
          className="w-full h-1.5 appearance-none bg-white/20 rounded-full cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-main
            [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:active:cursor-grabbing
            [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-red-main
            [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab"
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Play/Pause toggle */}
          <button onClick={isPlaying ? onPause : onPlay}
            className="w-9 h-9 flex items-center justify-center rounded-full
              bg-white/10 hover:bg-white/20 transition-colors text-white"
            title={isPlaying ? 'Durdur' : 'Oynat'}>
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>

          {/* Time display */}
          <span className="text-white/80 text-sm font-mono tabular-nums">
            {formatTime(currentTime)} / {durationKnown ? formatTime(sliderMax) : '--:--'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Fullscreen toggle */}
          <button onClick={onToggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-full
              bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
            title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}>
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 0v12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
              </svg>
            )}
          </button>

          {/* Admin label */}
          <span className="text-white/40 text-xs font-medium tracking-wide uppercase">Admin</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Member Progress Bar — salt-okunur, yalnızca gösterim (Bölüm 3.3)
// Member'lar play/pause kontrolü görmez ama progress + süre görebilir.
// ============================================================
function MemberProgressBar({
  currentTime,
  duration,
}: {
  currentTime: number;
  duration: number | null;
}) {
  const sliderMax = duration && duration > 0 ? duration : Math.max(currentTime + 60, 300);
  const durationKnown = duration != null && duration > 0;
  const pct = Math.max(0, Math.min(100, (currentTime / sliderMax) * 100));

  const formatTime = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none
      bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 py-3">
      {/* Progress track (salt-okunur) */}
      <div className="relative mb-2 h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-red-main"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Time display */}
      <div className="flex items-center justify-between">
        <span className="text-white/80 text-sm font-mono tabular-nums">
          {formatTime(currentTime)} / {durationKnown ? formatTime(sliderMax) : '--:--'}
        </span>
        <span className="text-white/40 text-xs font-medium tracking-wide uppercase">İzleyici</span>
      </div>
    </div>
  );
}

// ============================================================
// Sync Badge
// ============================================================
function SyncBadge() {
  const syncStatus = useRoomStore((s) => s.syncStatus);
  const playerReady = useRoomStore((s) => s.playerReady);
  const room = useRoomStore((s) => s.room);
  if (!playerReady || !room?.playback.videoId) return null;
  const config: Record<string, { label: string; color: string }> = {
    synced: { label: 'Senkronize', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    'slightly-off': { label: 'Az fark', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    resyncing: { label: 'Senkronize ediliyor...', color: 'bg-red-main/20 text-red-soft border-red-main/30' },
    buffering: { label: 'Yükleniyor...', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    idle: { label: 'Bekleniyor', color: 'bg-white/5 text-text-muted border-white/10' },
  };
  const { label, color } = config[syncStatus] || config.idle;
  return (
    <div className={`absolute top-3 right-3 z-10 px-3 py-1.5 rounded-full text-xs font-semibold border ${color} backdrop-blur-sm transition-all duration-300`}>
      {label}
    </div>
  );
}
