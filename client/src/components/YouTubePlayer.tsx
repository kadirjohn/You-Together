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
//   1. Custom control bar for admin/owner: Play/Pause toggle + timeline slider
//   2. Own time tracking via 250ms interval (replaces YouTube infoDelivery)
//   3. Admin actions → sendCommand + socket emit → server broadcast → all clients sync
//   4. Initial sync: timeout fallback → sync:request → sync:command (seekTo + play/pause)
//   5. Muted autoplay fallback for browser autoplay policy
//   6. "Oynat" button as last-resort fallback when autoplay is blocked
//   7. YouTube controls kept (controls=1) as fallback
export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
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

  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [userManuallySeeked, setUserManuallySeeked] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false); // autoplay blocked
  // UI state — React state for rendering (refs are for logic, state for UI reactivity)
  const [uiPlaying, setUiPlaying] = useState(false);
  const [uiTime, setUiTime] = useState(0);

  // Player state tracking (all via refs for permanent listener access)
  const playerState = useRef({
    playing: false,
    currentTime: 0,
    lastTimeUpdate: 0,
    muted: false,
  });
  const videoDuration = useRef(7200); // fallback: 2 hours, updated via getDuration
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
    // controls=0 hides YouTube's own UI — our custom bar replaces it
    return `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&origin=${origin}&widget_referrer=${origin}&modestbranding=1&rel=0&iv_load_policy=3&autoplay=0&controls=0&fs=1`;
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
    if (!iframe?.contentWindow) {
      console.warn('[DEBUG] sendCommand FAILED — no contentWindow for:', func);
      return;
    }
    const id = ++commandId.current;
    console.log('[DEBUG] sendCommand:', func, JSON.stringify(args), `id=cmd_${id}`);
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args, id: `cmd_${id}` }),
      YT_ORIGIN,
    );
  }, []);

  // ============================================================
  // Muted autoplay helper — tries to start playback despite
  // browser autoplay policy by muting first, then unmuting.
  // Returns true if play was initiated.
  // ============================================================
  const tryMutedAutoplay = useCallback(() => {
    // Strategy: mute → playVideo → wait 800ms → unmute
    sendCommand('mute');
    playerState.current.muted = true;
    sendCommand('playVideo');

    // After 800ms, unmute
    setTimeout(() => {
      sendCommand('unMute');
      playerState.current.muted = false;
    }, 800);

    playerState.current.playing = true;
    playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true);
    return true;
  }, [sendCommand]);

  // ============================================================
  // Own time tracking timer — replaces YouTube infoDelivery.
  // ============================================================
  useEffect(() => {
    if (!playerReady || !videoId) {
      if (timeTimerRef.current) {
        clearInterval(timeTimerRef.current);
        timeTimerRef.current = null;
      }
      return;
    }

    timeTimerRef.current = setInterval(() => {
      if (playerState.current.playing && !applyingRemoteUpdate.current) {
        playerState.current.currentTime += 0.25;
        playerState.current.lastTimeUpdate = Date.now();
      }
      // Sync UI state from refs every tick
      setUiPlaying(playerState.current.playing);
      setUiTime(getLiveTime());
    }, 250);

    return () => {
      if (timeTimerRef.current) {
        clearInterval(timeTimerRef.current);
        timeTimerRef.current = null;
      }
    };
  }, [playerReady, videoId]);

  // ============================================================
  // PERMANENT message listener — attached ONCE, never removed.
  // ============================================================
  useEffect(() => {
    if (listenerAttached.current) return;
    listenerAttached.current = true;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== YT_ORIGIN) return;

      let data: any;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }

      // onReady
      if (data.event === 'onReady') {
        if (syncFallbackTimer.current) {
          clearTimeout(syncFallbackTimer.current);
          syncFallbackTimer.current = null;
        }
        setPlayerReady(true);
        useRoomStore.getState().setPlayerReady(true);
        setBuffering(false);

        // Request video duration
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
          if (playback.status === 'playing') {
            tryMutedAutoplay();
          } else if (playback.status === 'paused') {
            sendCommand('pauseVideo');
            playerState.current.playing = false;
          }
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

      // onStateChange
      if (data.event === 'onStateChange') {
        const state = data.info ?? data.data;
        const storeState = useRoomStore.getState();
        if (state === 1) {
          setBuffering(false);
          setNeedsUserInteraction(false);
          playerState.current.playing = true;
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const rid = roomIdRef.current;
            if (rid) {
              getSocket().emit('playback:play', {
                roomId: rid,
                currentTime: getLiveTime(),
                clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              });
            }
          }
        } else if (state === 2) {
          playerState.current.playing = false;
          playerState.current.lastTimeUpdate = Date.now();
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const rid = roomIdRef.current;
            if (rid) {
              getSocket().emit('playback:pause', {
                roomId: rid,
                currentTime: getLiveTime(),
                clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              });
            }
          }
        } else if (state === 3) {
          setBuffering(true);
          useRoomStore.getState().setSyncStatus('buffering');
          playerState.current.playing = false;
          const rid = roomIdRef.current;
          if (rid) getSocket().emit('client:buffering', { roomId: rid });
        }
        return;
      }

      // infoDelivery — currentTime + duration updates
      if (data.event === 'infoDelivery' || data.info?.currentTime !== undefined) {
        const info = data.info ?? data;
        if (typeof info?.currentTime === 'number') {
          playerState.current.currentTime = info.currentTime;
          playerState.current.lastTimeUpdate = Date.now();
        }
        if (typeof info?.duration === 'number' && info.duration > 0) {
          videoDuration.current = info.duration;
        }
        if (typeof info?.muted === 'boolean') {
          playerState.current.muted = info.muted;
        }
        // If we get infoDelivery, YouTube API is working — clear needsUserInteraction
        if (info?.playerState === 1 || info?.currentTime !== undefined) {
          setNeedsUserInteraction(false);
        }
        return;
      }

      // onError
      if (data.event === 'onError') {
        const errorCode = data.info ?? data.data;
        const toast = addToastRef.current;
        if (!toast) return;
        if (errorCode === 101 || errorCode === 150) {
          toast('Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.', 'error');
        } else if (errorCode === 100) {
          toast('Bu video bulunamadı veya kaldırılmış.', 'error');
        } else if (errorCode === 5) {
          toast('Video oynatılamadı. YouTube hesabınıza giriş yapıp tekrar deneyin.', 'error');
        } else {
          toast('Video yüklenirken bir hata oluştu.', 'error');
        }
        return;
      }
    };

    window.addEventListener('message', handleMessage);
  }, []);

  // ============================================================
  // Timeout fallback: if onReady doesn't fire within 3s.
  // ============================================================
  useEffect(() => {
    if (!videoId) {
      setPlayerReady(false);
      setNeedsUserInteraction(false);
      initialSyncDone.current = false;
      return;
    }

    setPlayerReady(false);
    setBuffering(false);
    setNeedsUserInteraction(false);
    initialSyncDone.current = false;
    playerState.current = { playing: false, currentTime: 0, lastTimeUpdate: 0, muted: false };
    lastLocalTime.current = 0;
    lastCheckTime.current = Date.now();
    videoDuration.current = 7200;

    if (syncFallbackTimer.current) {
      clearTimeout(syncFallbackTimer.current);
      syncFallbackTimer.current = null;
    }

    syncFallbackTimer.current = setTimeout(() => {
      if (initialSyncDone.current) return;
      const rid = roomIdRef.current;
      if (rid) {
        getSocket().emit('sync:request', { roomId: rid, localTime: 0, playerState: 'desynced' });
      }
      setPlayerReady(true);
      useRoomStore.getState().setPlayerReady(true);
      initialSyncDone.current = true;
      // Request duration even in fallback
      sendCommand('getDuration');
    }, 3000);

    return () => {
      if (syncFallbackTimer.current) {
        clearTimeout(syncFallbackTimer.current);
        syncFallbackTimer.current = null;
      }
    };
  }, [videoId]);

  // ============================================================
  // sync:command listener — server → client sync commands.
  // Uses muted autoplay fallback for playVideo.
  // ============================================================
  useEffect(() => {
    const rid = roomIdFromStore;
    if (!rid) return;

    const socket = getSocket();
    const handleSyncCommand = (data: any) => {
      applyingRemoteUpdate.current = true;
      try {
        if (typeof data.targetTime === 'number') {
          sendCommand('seekTo', [data.targetTime, true]);
          playerState.current.currentTime = data.targetTime;
          playerState.current.lastTimeUpdate = Date.now();
        }
        if (data.status === 'playing') {
          tryMutedAutoplay();
          setUiPlaying(true);
        } else if (data.status === 'paused') {
          sendCommand('pauseVideo');
          playerState.current.playing = false;
          setUiPlaying(false);
          setNeedsUserInteraction(false);
        }
        useRoomStore.getState().setLastRemoteVersion(data.version || 0);
        setUserManuallySeeked(false);
        lastLocalTime.current = playerState.current.currentTime;
        lastCheckTime.current = Date.now();
      } finally {
        setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
      }
    };

    socket.on('sync:command', handleSyncCommand);
    return () => {
      socket.off('sync:command', handleSyncCommand);
    };
  }, [roomIdFromStore, sendCommand, tryMutedAutoplay]);

  // ============================================================
  // Drift sync loop — keeps local time aligned with server.
  // ============================================================
  useEffect(() => {
    if (!playerReady || !roomIdFromStore) return;

    let tickCount = 0;

    const interval = setInterval(() => {
      const state = useRoomStore.getState();
      if (!state.room?.playback.videoId) return;
      if (applyingRemoteUpdate.current) return;

      const localTime = getLiveTime();

      // Seek detection — skip during remote sync
      const now = Date.now();
      const elapsed = (now - lastCheckTime.current) / 1000;
      const expectedLocal = lastLocalTime.current + (playerState.current.playing ? elapsed : 0);
      const jump = Math.abs(localTime - expectedLocal);

      if (jump > 3 && lastLocalTime.current > 0 && !isRemoteSyncing.current) {
        setUserManuallySeeked(true);
      }

      lastLocalTime.current = localTime;
      lastCheckTime.current = now;

      tickCount++;
      if (tickCount % 2 !== 0) return;

      if (userManuallySeeked) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        return;
      }

      const expectedTime = computeExpectedRoomTime(
        {
          baseTime: state.room.playback.baseTime,
          baseServerTime: state.room.playback.baseServerTime,
          status: state.room.playback.status,
        },
        state.serverOffsetMs,
      );

      const drift = localTime - expectedTime;
      const absDrift = Math.abs(drift);

      if (absDrift <= 1.5) {
        useRoomStore.getState().setSyncStatus('synced');
        return;
      }

      if (absDrift <= 2.5) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        return;
      }

      if (absDrift <= 3) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        isRemoteSyncing.current = true;
        applyingRemoteUpdate.current = true;
        sendCommand('seekTo', [expectedTime, true]);
        playerState.current.currentTime = expectedTime;
        playerState.current.lastTimeUpdate = Date.now();
        lastLocalTime.current = expectedTime;
        lastCheckTime.current = Date.now();
        setTimeout(() => {
          applyingRemoteUpdate.current = false;
          isRemoteSyncing.current = false;
        }, 1500);
        return;
      }

      useRoomStore.getState().setSyncStatus('resyncing');
      isRemoteSyncing.current = true;
      applyingRemoteUpdate.current = true;
      sendCommand('seekTo', [expectedTime, true]);
      playerState.current.currentTime = expectedTime;
      playerState.current.lastTimeUpdate = Date.now();
      lastLocalTime.current = expectedTime;
      lastCheckTime.current = Date.now();
      const toast = addToastRef.current;
      if (toast) toast('Oda zamanına senkronize edildin.', 'info');
      setTimeout(() => {
        applyingRemoteUpdate.current = false;
        isRemoteSyncing.current = false;
      }, 1500);
    }, 1000);

    return () => clearInterval(interval);
  }, [playerReady, roomIdFromStore, userManuallySeeked, sendCommand, getLiveTime]);

  // ============================================================
  // Version watch — instant sync when server playback version changes.
  // Uses muted autoplay fallback. If autoplay is blocked, shows
  // "Oynat" button for user interaction.
  // ============================================================
  const playbackVersion = useRoomStore((s) => s.room?.playback.version ?? 0);

  useEffect(() => {
    if (!playerReady || !roomIdFromStore || playbackVersion === 0) return;

    const state = useRoomStore.getState();
    const playback = state.room?.playback;
    if (!playback?.videoId || playback.baseServerTime <= 0) return;

    console.log('[DEBUG] version watch triggered — version:', playbackVersion,
      'status:', playback.status, 'updatedBy:', playback.updatedBy,
      'myUserId:', state.currentUser?.id);

    // Skip if this version change was triggered by our own action.
    const myUserId = state.currentUser?.id;
    if (myUserId && playback.updatedBy === myUserId) {
      console.log('[DEBUG] version watch — SKIP (own action)');
      return;
    }

    const targetTime = computeExpectedRoomTime(
      {
        baseTime: playback.baseTime,
        baseServerTime: playback.baseServerTime,
        status: playback.status,
      },
      state.serverOffsetMs,
    );

    isRemoteSyncing.current = true;
    applyingRemoteUpdate.current = true;
    sendCommand('seekTo', [targetTime, true]);
    playerState.current.currentTime = targetTime;
    playerState.current.lastTimeUpdate = Date.now();
    lastLocalTime.current = targetTime;
    lastCheckTime.current = Date.now();

    if (playback.status === 'playing') {
      tryMutedAutoplay();
      setUiPlaying(true);

      // Fallback: if autoplay is blocked, show "Oynat" button after 2s
      if (autoplayRetryTimer.current) clearTimeout(autoplayRetryTimer.current);
      autoplayRetryTimer.current = setTimeout(() => {
        if (!playerState.current.playing) {
          setNeedsUserInteraction(true);
        }
      }, 2000);
    } else if (playback.status === 'paused') {
      sendCommand('pauseVideo');
      playerState.current.playing = false;
      setUiPlaying(false);
      setNeedsUserInteraction(false);
    }

    setUserManuallySeeked(false);

    setTimeout(() => {
      applyingRemoteUpdate.current = false;
      isRemoteSyncing.current = false;
    }, 1500);
  }, [playbackVersion]);

  // ============================================================
  // Admin control handlers — emit to server + sendCommand.
  // ============================================================
  const handleAdminPlay = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid) return;
    const time = getLiveTime();
    const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    applyingRemoteUpdate.current = true;
    sendCommand('playVideo');
    playerState.current.playing = true;
    playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true);
    setNeedsUserInteraction(false);

    getSocket().emit('playback:play', { roomId: rid, currentTime: time, clientEventId });

    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand, getLiveTime]);

  const handleAdminPause = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid) return;
    const time = getLiveTime();
    const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    console.log('[DEBUG] handleAdminPause — time:', time, 'roomId:', rid);
    applyingRemoteUpdate.current = true;
    sendCommand('pauseVideo');
    playerState.current.playing = false;
    playerState.current.currentTime = time;
    playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(false);
    setUiTime(time);

    getSocket().emit('playback:pause', { roomId: rid, currentTime: time, clientEventId });
    console.log('[DEBUG] handleAdminPause — emitted playback:pause');

    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand, getLiveTime]);

  const handleAdminSeek = useCallback((targetTime: number) => {
    const rid = roomIdRef.current;
    if (!rid) return;
    const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    applyingRemoteUpdate.current = true;
    sendCommand('seekTo', [targetTime, true]);
    // Explicitly play after seek — YouTube seekTo may not preserve play state
    sendCommand('playVideo');
    playerState.current.currentTime = targetTime;
    playerState.current.lastTimeUpdate = Date.now();
    playerState.current.playing = true;
    lastLocalTime.current = targetTime;
    lastCheckTime.current = Date.now();
    setUiPlaying(true);
    setUiTime(targetTime);
    setNeedsUserInteraction(false);

    getSocket().emit('playback:seek', {
      roomId: rid,
      targetTime,
      shouldPlay: true,
      clientEventId,
    });

    setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
  }, [sendCommand]);

  const handleRejoinRoom = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid) return;
    applyingRemoteUpdate.current = true;

    getSocket().emit('sync:request', {
      roomId: rid,
      localTime: getLiveTime(),
      playerState: 'desynced',
    });

    setTimeout(() => {
      applyingRemoteUpdate.current = false;
      setUserManuallySeeked(false);
    }, 1000);
  }, [getLiveTime]);

  // User clicks "Oynat" button — provides user interaction to bypass autoplay policy
  const handleUserPlay = useCallback(() => {
    sendCommand('playVideo');
      playerState.current.playing = true;
      playerState.current.lastTimeUpdate = Date.now();
      setUiPlaying(true);
      setNeedsUserInteraction(false);
    }, [sendCommand]);

  if (!videoId || !embedUrl) return null;

  const isPlaying = uiPlaying;
  const displayTime = uiTime;

  return (
    <div className="relative w-full h-full group">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen"
        title="YouTube video player"
      />

      {/* Buffering overlay */}
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

      {/* "Oynat" button — shown when autoplay is blocked (needs user interaction) */}
      {needsUserInteraction && !buffering && playerReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-20">
          <button
            onClick={handleUserPlay}
            className="px-8 py-4 bg-red-main text-white font-bold text-lg rounded-2xl
              glow-red hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-[0.98] shadow-xl
              flex items-center gap-3"
          >
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Videoyu Oynat
          </button>
        </div>
      )}

      {/* Manual seek rejoin button */}
      {userManuallySeeked && !buffering && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 animate-fade-in">
          <button
            onClick={handleRejoinRoom}
            className="px-5 py-3 bg-red-main text-white font-semibold rounded-xl
              glow-red hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-[0.98] shadow-lg
              flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Beraber izlemeye devam et
          </button>
        </div>
      )}

      {/* Sync badge */}
      <SyncBadge />

      {/* Center play/pause overlay — large button for admin */}
      {isAdmin && playerReady && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center z-15 pointer-events-none">
          <button
            onClick={isPlaying ? handleAdminPause : handleAdminPlay}
            className="pointer-events-auto w-16 h-16 flex items-center justify-center rounded-full
              bg-white/10 hover:bg-white/25 backdrop-blur-sm transition-all duration-200
              text-white opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
            title={isPlaying ? 'Durdur' : 'Oynat'}
          >
            {isPlaying ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
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
          onPlay={handleAdminPlay}
          onPause={handleAdminPause}
          onSeek={handleAdminSeek}
        />
      )}
    </div>
  );
}

// ============================================================
// Admin Control Bar — Play/Pause toggle + timeline slider.
// Uses actual video duration when available.
// ============================================================
function AdminControlBar({
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onPause,
  onSeek,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
}) {
  const [sliderValue, setSliderValue] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingValueRef = useRef(0);

  // Update slider when not dragging
  useEffect(() => {
    if (!isDragging) {
      setSliderValue(currentTime);
    }
  }, [currentTime, isDragging]);

  const formatTime = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSliderValue(val);
    draggingValueRef.current = val;
  };

  const handleSliderDown = () => {
    setIsDragging(true);
  };

  const handleSliderUp = () => {
    setIsDragging(false);
    onSeek(draggingValueRef.current);
  };

  // Use actual duration if available, otherwise fallback
  const sliderMax = duration > 0 ? duration : Math.max(currentTime + 120, 600);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-20
        bg-gradient-to-t from-black/90 via-black/60 to-transparent
        px-4 py-3 opacity-100"
    >
      {/* Timeline slider */}
      <div className="mb-2">
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.5}
          value={sliderValue}
          onChange={handleSliderChange}
          onMouseDown={handleSliderDown}
          onMouseUp={handleSliderUp}
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
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="w-9 h-9 flex items-center justify-center rounded-full
              bg-white/10 hover:bg-white/20 transition-colors text-white"
            title={isPlaying ? 'Durdur' : 'Oynat'}
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Time display */}
          <span className="text-white/80 text-sm font-mono tabular-nums">
            {formatTime(currentTime)} / {formatTime(sliderMax)}
          </span>
        </div>

        {/* Admin label */}
        <span className="text-white/40 text-xs font-medium tracking-wide uppercase">
          Admin Kontrol
        </span>
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
