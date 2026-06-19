import { useRef, useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { computeExpectedRoomTime } from '../lib/time';

let ytApiReady = false;
const ytReadyCallbacks: Array<() => void> = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiReady) {
      resolve();
      return;
    }

    if (document.getElementById('yt-iframe-api')) {
      ytReadyCallbacks.push(resolve);
      return;
    }

    const tag = document.createElement('script');
    tag.id = 'yt-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      ytReadyCallbacks.forEach((cb) => cb());
      ytReadyCallbacks.length = 0;
    };

    ytReadyCallbacks.push(resolve);
  });
}

interface YouTubePlayerProps {
  videoId: string | null;
}

export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const playerRef = useRef<any>(null);
  const containerId = useRef(`yt-player-${Math.random().toString(36).slice(2)}`).current;
  const roomId = useRoomStore((s) => s.room?.id);
  const setStorePlayerReady = useRoomStore((s) => s.setPlayerReady);
  const addToast = useUIStore((s) => s.addToast);

  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [userManuallySeeked, setUserManuallySeeked] = useState(false);
  const lastVideoId = useRef<string | null>(null);

  // Seek detection refs
  const lastLocalTime = useRef(0);
  const lastCheckTime = useRef(Date.now());

  // Sync & seek detection loop (runs every 1 second for seek detection, drift check every 2)
  useEffect(() => {
    if (!playerReady || !roomId) return;

    let tickCount = 0;

    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const state = useRoomStore.getState();
      if (!state.room?.playback.videoId) return;

      const localTime = player.getCurrentTime?.() || 0;

      // --- Seek Detection (every tick) ---
      if (!state.applyingRemoteUpdate) {
        const now = Date.now();
        const elapsed = (now - lastCheckTime.current) / 1000;
        const expectedLocal = lastLocalTime.current + elapsed;
        const jump = Math.abs(localTime - expectedLocal);

        // Detect manual seek: sudden jump > 3s that can't be explained by playback
        // Per Model B, user seeks stay local and don't sync to others.
        if (jump > 3 && lastLocalTime.current > 0) {
          setUserManuallySeeked(true);
        }

        lastLocalTime.current = localTime;
        lastCheckTime.current = now;
      }

      // --- Drift Check (every 2 ticks = 2 seconds) ---
      tickCount++;
      if (tickCount % 2 !== 0) return;

      // If user manually seeked, don't auto-correct — show button instead
      if (userManuallySeeked) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        return;
      }

      if (state.applyingRemoteUpdate) return;

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

      if (absDrift <= 7) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        useRoomStore.getState().setApplyingRemoteUpdate(true);
        player.seekTo?.(expectedTime, true);
        setTimeout(() => {
          useRoomStore.getState().setApplyingRemoteUpdate(false);
        }, 500);
        return;
      }

      useRoomStore.getState().setSyncStatus('resyncing');
      useRoomStore.getState().setApplyingRemoteUpdate(true);
      player.seekTo?.(expectedTime, true);
      addToast('Oda zamanına senkronize edildin.', 'info');
      setTimeout(() => {
        useRoomStore.getState().setApplyingRemoteUpdate(false);
      }, 500);
    }, 1000);

    return () => clearInterval(interval);
  }, [playerReady, roomId, userManuallySeeked]);

  // Reset seek detection on new video
  useEffect(() => {
    lastLocalTime.current = 0;
    lastCheckTime.current = Date.now();
    setUserManuallySeeked(false);
  }, [videoId]);

  // Create / destroy player
  useEffect(() => {
    if (!videoId) {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setPlayerReady(false);
      return;
    }

    loadYouTubeAPI().then(() => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setPlayerReady(false);

      playerRef.current = new (window as any).YT.Player(containerId, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          fs: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
          host: 'https://www.youtube.com',
          widget_referrer: window.location.origin,
        },
        events: {
          onReady: () => {
            setPlayerReady(true);
            setStorePlayerReady(true);
            setBuffering(false);
            lastLocalTime.current = 0;
            lastCheckTime.current = Date.now();
            if (roomId) {
              getSocket().emit('client:player-ready', { roomId });
            }
          },
          onStateChange: (event: any) => {
            const state = useRoomStore.getState();
            const player = playerRef.current;

            if (state.applyingRemoteUpdate) return;

            const YT = (window as any).YT;
            if (event.data === YT.PlayerState.PLAYING) {
              setBuffering(false);
              const currentTime = player.getCurrentTime?.() || 0;
              const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
              if (roomId) {
                getSocket().emit('playback:play', { roomId, currentTime, clientEventId });
              }
            } else if (event.data === YT.PlayerState.PAUSED) {
              const currentTime = player.getCurrentTime?.() || 0;
              const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
              if (roomId) {
                getSocket().emit('playback:pause', { roomId, currentTime, clientEventId });
              }
            } else if (event.data === YT.PlayerState.BUFFERING) {
              setBuffering(true);
              useRoomStore.getState().setSyncStatus('buffering');
              if (roomId) {
                getSocket().emit('client:buffering', { roomId });
              }
            }
          },
          onError: (event: any) => {
            // YouTube error codes:
            // 2 - Invalid parameter
            // 5 - HTML5 player error
            // 100 - Video not found / removed
            // 101 - Embed not allowed
            // 150 - Embed not allowed (another variant)
            const errorCode = event?.data;
            if (errorCode === 101 || errorCode === 150) {
              addToast('Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.', 'error');
            } else if (errorCode === 100) {
              addToast('Bu video bulunamadı veya kaldırılmış.', 'error');
            } else if (errorCode === 5) {
              // HTML5 player error - often bot detection or browser issue
              addToast('Video oynatılamadı. YouTube hesabınıza giriş yapıp tekrar deneyin veya farklı bir video deneyin.', 'error');
            } else {
              addToast('Video yüklenirken bir hata oluştu. Başka bir video deneyin.', 'error');
            }
          },
        },
      });
    });

    lastVideoId.current = videoId;

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId]);

  // Listen for sync commands from server
  useEffect(() => {
    if (!roomId) return;

    const socket = getSocket();
    const handleSyncCommand = (data: any) => {
      if (!playerRef.current) return;
      const player = playerRef.current;
      useRoomStore.getState().setApplyingRemoteUpdate(true);

      try {
        if (typeof data.targetTime === 'number') {
          player.seekTo?.(data.targetTime, true);
        }
        if (data.status === 'playing') {
          player.playVideo?.();
        } else if (data.status === 'paused') {
          player.pauseVideo?.();
        }
        useRoomStore.getState().setLastRemoteVersion(data.version || 0);
        setUserManuallySeeked(false);
        lastLocalTime.current = player.getCurrentTime?.() || 0;
        lastCheckTime.current = Date.now();
      } finally {
        setTimeout(() => {
          useRoomStore.getState().setApplyingRemoteUpdate(false);
        }, 500);
      }
    };

    socket.on('sync:command', handleSyncCommand);
    return () => {
      socket.off('sync:command', handleSyncCommand);
    };
  }, [roomId]);

  const handleRejoinRoom = () => {
    if (!playerRef.current || !roomId) return;
    const player = playerRef.current;
    useRoomStore.getState().setApplyingRemoteUpdate(true);

    getSocket().emit('sync:request', {
      roomId,
      localTime: player.getCurrentTime?.() || 0,
      playerState: 'desynced',
    });

    // The sync:command response will handle the actual sync
    setTimeout(() => {
      useRoomStore.getState().setApplyingRemoteUpdate(false);
      setUserManuallySeeked(false);
    }, 1000);
  };

  if (!videoId) return null;

  return (
    <div className="relative w-full h-full">
      <div id={containerId} className="w-full h-full" />

      {/* Buffering overlay */}
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

      {/* "Beraber izlemeye devam et" overlay */}
      {userManuallySeeked && !buffering && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 animate-fade-in">
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

      {/* Autoplay overlay */}
      {showAutoplayOverlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-10">
          <div className="text-center p-6">
            <div className="text-4xl mb-3">▶️</div>
            <p className="text-text-main font-semibold mb-2">
              Video hazır. Oda ile beraber izlemeye başlamak için tıkla.
            </p>
            <button
              onClick={() => {
                setShowAutoplayOverlay(false);
                const player = playerRef.current;
                if (!player || !roomId) return;
                getSocket().emit('sync:request', {
                  roomId,
                  localTime: player.getCurrentTime?.() || 0,
                  playerState: 'ready',
                });
              }}
              className="px-5 py-2.5 bg-red-main text-white font-semibold rounded-xl
                glow-red-sm hover:glow-red transition-all duration-300 mt-3"
            >
              Oynat ve senkronize ol
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// SyncBadge component - shows sync status
function SyncBadge() {
  const syncStatus = useRoomStore((s) => s.syncStatus);
  const playerReady = useRoomStore((s) => s.playerReady);
  const room = useRoomStore((s) => s.room);

  if (!playerReady || !room?.playback.videoId) return null;

  const config = {
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
