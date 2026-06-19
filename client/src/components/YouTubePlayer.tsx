import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { computeExpectedRoomTime } from '../lib/time';

const YT_ORIGIN = 'https://www.youtube.com';

interface YouTubePlayerProps {
  videoId: string | null;
}

// Plain iframe embed + direct postMessage API — no YT.Player dependency.
// Uses youtube.com with session cookies — works when deployed on a real domain
// (ngrok, production, etc.) where YouTube can verify the user's identity.
// For localhost dev: use ngrok tunnel to get a public URL.
// Player state tracked manually via refs with time interpolation.
export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roomId = useRoomStore((s) => s.room?.id);
  const setStorePlayerReady = useRoomStore((s) => s.setPlayerReady);
  const addToast = useUIStore((s) => s.addToast);
  const commandId = useRef(0);

  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [userManuallySeeked, setUserManuallySeeked] = useState(false);

  // Player state tracking
  const playerState = useRef({
    playing: false,
    currentTime: 0,
    lastTimeUpdate: 0,   // Date.now() when currentTime was last set
    muted: false,
  });
  const lastLocalTime = useRef(0);
  const lastCheckTime = useRef(Date.now());
  const applyingRemoteUpdate = useRef(false);

  // Build embed URL once
  const embedUrl = useMemo(() => {
    if (!videoId) return '';
    const origin = encodeURIComponent(window.location.origin);
    return `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&origin=${origin}&widget_referrer=${origin}&modestbranding=1&rel=0&iv_load_policy=3&autoplay=0&controls=1&fs=1`;
  }, [videoId]);

  // Get live current time (interpolated between infoDelivery events)
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

  // Seek detection & drift sync loop
  useEffect(() => {
    if (!playerReady || !roomId) return;

    let tickCount = 0;

    const interval = setInterval(() => {
      const state = useRoomStore.getState();
      if (!state.room?.playback.videoId) return;
      if (applyingRemoteUpdate.current) return;

      const localTime = getLiveTime();

      // Seek detection
      const now = Date.now();
      const elapsed = (now - lastCheckTime.current) / 1000;
      const expectedLocal = lastLocalTime.current + (playerState.current.playing ? elapsed : 0);
      const jump = Math.abs(localTime - expectedLocal);

      if (jump > 3 && lastLocalTime.current > 0) {
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

      if (absDrift <= 7) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        applyingRemoteUpdate.current = true;
        sendCommand('seekTo', [expectedTime, true]);
        playerState.current.currentTime = expectedTime;
        playerState.current.lastTimeUpdate = Date.now();
        setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
        return;
      }

      useRoomStore.getState().setSyncStatus('resyncing');
      applyingRemoteUpdate.current = true;
      sendCommand('seekTo', [expectedTime, true]);
      playerState.current.currentTime = expectedTime;
      playerState.current.lastTimeUpdate = Date.now();
      addToast('Oda zamanına senkronize edildin.', 'info');
      setTimeout(() => { applyingRemoteUpdate.current = false; }, 500);
    }, 1000);

    return () => clearInterval(interval);
  }, [playerReady, roomId, userManuallySeeked, sendCommand, getLiveTime]);

  // Reset on video change
  useEffect(() => {
    lastLocalTime.current = 0;
    lastCheckTime.current = Date.now();
    setUserManuallySeeked(false);
    playerState.current = { playing: false, currentTime: 0, lastTimeUpdate: 0, muted: false };
  }, [videoId]);

  // Create iframe & listen for postMessage events
  useEffect(() => {
    if (!videoId) {
      setPlayerReady(false);
      return;
    }

    setPlayerReady(false);
    setBuffering(false);

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
        setPlayerReady(true);
        setStorePlayerReady(true);
        setBuffering(false);
        playerState.current.currentTime = 0;
        playerState.current.lastTimeUpdate = Date.now();
        lastLocalTime.current = 0;
        lastCheckTime.current = Date.now();
        if (roomId) {
          getSocket().emit('client:player-ready', { roomId });
        }
        return;
      }

      // onStateChange: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
      if (data.event === 'onStateChange') {
        const state = data.info ?? data.data;
        const storeState = useRoomStore.getState();

        if (state === 1) {
          setBuffering(false);
          playerState.current.playing = true;
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            if (roomId) {
              getSocket().emit('playback:play', {
                roomId,
                currentTime: getLiveTime(),
                clientEventId,
              });
            }
          }
        } else if (state === 2) {
          playerState.current.playing = false;
          // Update time precisely on pause
          playerState.current.lastTimeUpdate = Date.now();
          if (!applyingRemoteUpdate.current && !storeState.applyingRemoteUpdate) {
            const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            if (roomId) {
              getSocket().emit('playback:pause', {
                roomId,
                currentTime: getLiveTime(),
                clientEventId,
              });
            }
          }
        } else if (state === 3) {
          setBuffering(true);
          useRoomStore.getState().setSyncStatus('buffering');
          playerState.current.playing = false;
          if (roomId) {
            getSocket().emit('client:buffering', { roomId });
          }
        }
        return;
      }

      // infoDelivery — currentTime updates from YouTube
      if (data.event === 'infoDelivery' || data.info?.currentTime !== undefined) {
        const info = data.info ?? data;
        if (typeof info?.currentTime === 'number') {
          playerState.current.currentTime = info.currentTime;
          playerState.current.lastTimeUpdate = Date.now();
        }
        if (typeof info?.muted === 'boolean') {
          playerState.current.muted = info.muted;
        }
        return;
      }

      // onError
      if (data.event === 'onError') {
        const errorCode = data.info ?? data.data;
        if (errorCode === 101 || errorCode === 150) {
          addToast('Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.', 'error');
        } else if (errorCode === 100) {
          addToast('Bu video bulunamadı veya kaldırılmış.', 'error');
        } else if (errorCode === 5) {
          addToast('Video oynatılamadı. YouTube hesabınıza giriş yapıp tekrar deneyin.', 'error');
        } else {
          addToast('Video yüklenirken bir hata oluştu.', 'error');
        }
        return;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [videoId]);

  // Sync command handler
  useEffect(() => {
    if (!roomId) return;

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
          sendCommand('playVideo');
          playerState.current.playing = true;
        } else if (data.status === 'paused') {
          sendCommand('pauseVideo');
          playerState.current.playing = false;
        }
        useRoomStore.getState().setLastRemoteVersion(data.version || 0);
        setUserManuallySeeked(false);
        lastLocalTime.current = playerState.current.currentTime;
        lastCheckTime.current = Date.now();
      } finally {
        setTimeout(() => {
          applyingRemoteUpdate.current = false;
        }, 500);
      }
    };

    socket.on('sync:command', handleSyncCommand);
    return () => {
      socket.off('sync:command', handleSyncCommand);
    };
  }, [roomId, sendCommand]);

  const handleRejoinRoom = () => {
    if (!roomId) return;
    applyingRemoteUpdate.current = true;

    getSocket().emit('sync:request', {
      roomId,
      localTime: getLiveTime(),
      playerState: 'desynced',
    });

    setTimeout(() => {
      applyingRemoteUpdate.current = false;
      setUserManuallySeeked(false);
    }, 1000);
  };

  if (!videoId || !embedUrl) return null;

  return (
    <div className="relative w-full h-full">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen"
        title="YouTube video player"
      />

      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

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

      <SyncBadge />

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
                if (!roomId) return;
                sendCommand('playVideo');
                getSocket().emit('sync:request', {
                  roomId,
                  localTime: getLiveTime(),
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
