import { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import toWebVTT from 'srt-webvtt';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { computeExpectedRoomTime, calculateMedian } from '../lib/time';

interface HtmlPlayerProps {
  mediaType: 'mp4' | 'hls';
  mediaUrl: string;
}

export default function HtmlPlayer({ mediaType, mediaUrl }: HtmlPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const roomIdRef = useRef<string | undefined>();
  const roomIdFromStore = useRoomStore((s) => s.room?.id);
  roomIdRef.current = roomIdFromStore;

  const [playerReady, setPlayerReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const realTimeRef = useRef(0);
  const realTimeAtRef = useRef(0);
  const applyingRemoteUpdate = useRef(false);
  const remoteGuardUntil = useRef(0);
  const initialSyncDone = useRef(false);
  const lastSeekCheckTime = useRef(0);
  const lastSeekCheckRealTime = useRef(0);
  const lastAppliedPlaybackRate = useRef(1);
  const loopEnabled = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoEndedRef = useRef(false);

  const iAmAdmin = useCallback((): boolean => {
    const role = useRoomStore.getState().currentUser?.role;
    return role === 'owner' || role === 'admin';
  }, []);

  const safeCall = useCallback(<T,>(fn: () => T): T | undefined => {
    const video = videoRef.current;
    if (!video) return undefined;
    try { return fn(); } catch { return undefined; }
  }, []);

  const startPlayback = useCallback(() => {
    safeCall(() => videoRef.current?.play());
  }, [safeCall]);

  const pausePlayback = useCallback(() => {
    safeCall(() => videoRef.current?.pause());
  }, [safeCall]);

  const seekTo = useCallback((time: number) => {
    if (!Number.isFinite(time) || time < 0) return;
    safeCall(() => {
      const v = videoRef.current!;
      v.currentTime = time;
    });
    realTimeRef.current = time;
    realTimeAtRef.current = Date.now();
  }, [safeCall]);

  const applyRemoteState = useCallback((
    status: 'playing' | 'paused' | 'idle',
    time: number,
    guardMs: number = 700,
  ) => {
    applyingRemoteUpdate.current = true;
    remoteGuardUntil.current = Date.now() + guardMs;
    useRoomStore.getState().setRoomPlaybackStatus(status);
    seekTo(Math.max(0, time));
    if (status === 'playing') startPlayback();
    else pausePlayback();
    if (lastAppliedPlaybackRate.current !== 1) {
      safeCall(() => { videoRef.current!.playbackRate = 1; });
      lastAppliedPlaybackRate.current = 1;
    }
    setBuffering(false);
    setTimeout(() => { applyingRemoteUpdate.current = false; }, guardMs);
  }, [seekTo, startPlayback, pausePlayback, safeCall]);

  const resyncToLeader = useCallback(() => {
    const state = useRoomStore.getState();
    const roomStatus = state.roomPlaybackStatus;
    const tsMap = state.tsMap;
    const adminId = state.adminUserId;
    let leader = 0;
    if (adminId && typeof tsMap[adminId] === 'number') leader = tsMap[adminId];
    else if (Object.values(tsMap).length > 0) {
      leader = Object.values(tsMap).length > 2
        ? calculateMedian(Object.values(tsMap))
        : Math.max(...Object.values(tsMap));
    } else if (state.room?.playback) {
      leader = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
    }
    if (leader <= 0 && roomStatus === 'idle') return;
    applyRemoteState(roomStatus, leader, 900);
  }, [applyRemoteState]);

  const isOutOfSync = useCallback((thresholdSeconds: number): boolean => {
    const video = videoRef.current;
    if (!video) return false;
    const currentTime = video.currentTime;
    const state = useRoomStore.getState();
    const tsMap = state.tsMap;
    const adminId = state.adminUserId;
    let leader: number | undefined;
    if (adminId && typeof tsMap[adminId] === 'number') leader = tsMap[adminId];
    else if (Object.values(tsMap).length > 0) {
      leader = Object.values(tsMap).length > 2
        ? calculateMedian(Object.values(tsMap))
        : Math.max(...Object.values(tsMap));
    } else if (state.room?.playback) {
      leader = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
    }
    if (typeof leader !== 'number') return false;
    return Math.abs(currentTime - leader) > thresholdSeconds;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Initial video attach + sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Cleanup previous hls
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setPlayerReady(false);
    setBuffering(false);
    setVideoEnded(false);
    videoEndedRef.current = false;
    initialSyncDone.current = false;
    realTimeRef.current = 0;
    realTimeAtRef.current = Date.now();
    lastAppliedPlaybackRate.current = 1;

    if (mediaType === 'hls' && Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(mediaUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerReady(true);
        useRoomStore.getState().setPlayerReady(true);
        doInitialSync();
      });
    } else {
      video.src = mediaUrl;
      video.addEventListener('loadedmetadata', () => {
        setPlayerReady(true);
        useRoomStore.getState().setPlayerReady(true);
        doInitialSync();
      }, { once: true });
    }

    const doInitialSync = () => {
      if (initialSyncDone.current) return;
      initialSyncDone.current = true;
      const state = useRoomStore.getState();
      const playback = state.room?.playback;
      const rid = roomIdRef.current;
      if (playback && playback.baseServerTime > 0) {
        const targetTime = computeExpectedRoomTime(
          { baseTime: playback.baseTime, baseServerTime: playback.baseServerTime, status: playback.status },
          state.serverOffsetMs,
        );
        applyRemoteState(
          playback.status as 'playing' | 'paused' | 'idle',
          Math.max(0, targetTime),
          500,
        );
      } else {
        useRoomStore.getState().setRoomPlaybackStatus(playback?.status as any ?? 'idle');
      }
      if (rid) getSocket().emit('client:player-ready', { roomId: rid });
    };

    if (onReadyTimeoutRef.current) clearTimeout(onReadyTimeoutRef.current);
    onReadyTimeoutRef.current = setTimeout(() => {
      if (initialSyncDone.current) return;
      const rid = roomIdRef.current;
      if (rid) getSocket().emit('sync:request', { roomId: rid, localTime: 0, playerState: 'desynced' });
    }, 5000);

    return () => {
      if (onReadyTimeoutRef.current) { clearTimeout(onReadyTimeoutRef.current); onReadyTimeoutRef.current = null; }
    };
  }, [mediaType, mediaUrl, applyRemoteState]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      const roomStatus = useRoomStore.getState().roomPlaybackStatus;
      const admin = iAmAdmin();
      const guardActive = Date.now() < remoteGuardUntil.current;
      if (admin && !guardActive && roomStatus !== 'playing') {
        const rid = roomIdRef.current;
        if (rid) getSocket().emit('playback:play', { roomId: rid, currentTime: video.currentTime, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
        useRoomStore.getState().setRoomPlaybackStatus('playing');
      } else if (!admin && !guardActive && (roomStatus !== 'playing' || isOutOfSync(4))) {
        resyncToLeader();
      }
    };
    const onPause = () => {
      const roomStatus = useRoomStore.getState().roomPlaybackStatus;
      const admin = iAmAdmin();
      const guardActive = Date.now() < remoteGuardUntil.current;
      setBuffering(false);
      if (admin && !guardActive && roomStatus === 'playing') {
        const rid = roomIdRef.current;
        if (rid) getSocket().emit('playback:pause', { roomId: rid, currentTime: video.currentTime, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
        useRoomStore.getState().setRoomPlaybackStatus('paused');
      } else if (!admin && !guardActive && (roomStatus === 'playing' || isOutOfSync(4))) {
        resyncToLeader();
      }
    };
    const onSeeked = () => {
      const admin = iAmAdmin();
      const guardActive = Date.now() < remoteGuardUntil.current;
      if (admin && !guardActive) {
        const rid = roomIdRef.current;
        if (rid) getSocket().emit('playback:seek', { roomId: rid, targetTime: Math.max(0, video.currentTime), shouldPlay: true, clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
      } else if (!admin && !guardActive) {
        resyncToLeader();
      }
    };
    const onWaiting = () => {
      if (useRoomStore.getState().roomPlaybackStatus === 'playing') {
        setBuffering(true);
        useRoomStore.getState().setSyncStatus('buffering');
      }
      remoteGuardUntil.current = Math.max(remoteGuardUntil.current, Date.now() + 700);
    };
    const onPlaying = () => setBuffering(false);
    const onEnded = () => {
      if (loopEnabled.current) {
        videoEndedRef.current = false;
        setVideoEnded(false);
        applyRemoteState('playing', 0, 500);
        return;
      }
      videoEndedRef.current = true;
      setVideoEnded(true);
      if (iAmAdmin()) {
        const rid = roomIdRef.current;
        if (rid) getSocket().emit('playlist:next', { roomId: rid });
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('ended', onEnded);
    };
  }, [iAmAdmin, isOutOfSync, resyncToLeader, applyRemoteState]);

  // 500ms poll
  useEffect(() => {
    if (!playerReady) {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    lastSeekCheckTime.current = Date.now();
    lastSeekCheckRealTime.current = 0;

    pollTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const real = video.currentTime;
      const nowMs = Date.now();
      const state = useRoomStore.getState();
      const roomStatus = state.roomPlaybackStatus;
      const admin = iAmAdmin();

      const tsMap = state.tsMap;
      const adminId = state.adminUserId;
      let leaderTime: number | undefined;
      if (adminId && typeof tsMap[adminId] === 'number') leaderTime = tsMap[adminId];
      else if (Object.values(tsMap).length > 0) {
        leaderTime = Object.values(tsMap).length > 2
          ? calculateMedian(Object.values(tsMap))
          : Math.max(...Object.values(tsMap));
      } else if (state.room?.playback) {
        leaderTime = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
      }
      const drift = typeof leaderTime === 'number' ? real - leaderTime : 0;
      const absDrift = Math.abs(drift);

      if (admin) {
        if (!applyingRemoteUpdate.current && roomStatus === 'playing' && typeof leaderTime === 'number' && drift < 0) {
          if (absDrift > 0.5 && absDrift <= 3) {
            const pbr = Math.min(1 + absDrift / 10, 1.1);
            if (Math.abs(pbr - lastAppliedPlaybackRate.current) > 0.001) {
              video.playbackRate = pbr;
              lastAppliedPlaybackRate.current = pbr;
            }
          } else if (absDrift <= 0.3 && lastAppliedPlaybackRate.current !== 1) {
            video.playbackRate = 1;
            lastAppliedPlaybackRate.current = 1;
          }
        }
      } else {
        if (!applyingRemoteUpdate.current) {
          const playerPlaying = !video.paused && !video.ended;
          const roomPlaying = roomStatus === 'playing';
          const stateMismatch = playerPlaying !== roomPlaying;
          const tooFar = typeof leaderTime === 'number' && absDrift > 4;
          if (stateMismatch || tooFar) {
            resyncToLeader();
          } else if (roomPlaying && typeof leaderTime === 'number') {
            if (absDrift > 0.5 && drift < 0) {
              const pbr = Math.min(1 + absDrift / 10, 1.1);
              if (Math.abs(pbr - lastAppliedPlaybackRate.current) > 0.001) {
                video.playbackRate = pbr;
                lastAppliedPlaybackRate.current = pbr;
              }
            } else if (absDrift <= 0.3 && lastAppliedPlaybackRate.current !== 1) {
              video.playbackRate = 1;
              lastAppliedPlaybackRate.current = 1;
            }
          }
        }
      }
      lastSeekCheckTime.current = nowMs;
      lastSeekCheckRealTime.current = real;
      realTimeRef.current = real;
      realTimeAtRef.current = nowMs;
      if (roomStatus !== 'playing' && buffering) setBuffering(false);
    }, 500);

    return () => { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } };
  }, [playerReady, iAmAdmin, resyncToLeader]);

  // 1s heartbeat
  useEffect(() => {
    if (!playerReady || !roomIdFromStore) return;
    heartbeatTimerRef.current = setInterval(() => {
      if (applyingRemoteUpdate.current || Date.now() < remoteGuardUntil.current) return;
      const video = videoRef.current;
      if (!video) return;
      getSocket().emit('playback:heartbeat', { roomId: roomIdFromStore, currentTime: video.currentTime });
    }, 1000);
    return () => { if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; } };
  }, [playerReady, roomIdFromStore]);

  // Remote state listeners (sync:command + version watch + tsmap)
  useEffect(() => {
    const rid = roomIdFromStore;
    if (!rid) return;
    const socket = getSocket();

    const handleSyncCommand = (data: any) => {
      const status = data.status as string;
      const targetTime = typeof data.targetTime === 'number' ? data.targetTime : 0;
      applyRemoteState(
        status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'idle',
        Math.max(0, targetTime),
        500,
      );
      useRoomStore.getState().setLastRemoteVersion(data.version || 0);
    };

    const handlePlaybackRate = (data: { rate: number }) => {
      const fixedRate = data.rate;
      const video = videoRef.current;
      if (video) {
        if (fixedRate > 0) video.playbackRate = fixedRate;
        else video.playbackRate = 1;
      }
      lastAppliedPlaybackRate.current = fixedRate > 0 ? fixedRate : 1;
      useRoomStore.getState().updatePlayback({ playbackRate: fixedRate });
    };

    const handlePlaybackLoop = (data: { loop: boolean }) => {
      loopEnabled.current = data.loop;
      const video = videoRef.current;
      if (video) video.loop = data.loop;
      useRoomStore.getState().updatePlayback({ loop: data.loop });
    };

    const handleTsMap = (data: { tsMap: Record<string, number>; adminUserId: string | null }) => {
      useRoomStore.getState().setTsMap(data.tsMap);
      if (data.adminUserId) useRoomStore.getState().setAdminUserId(data.adminUserId);
    };

    socket.on('sync:command', handleSyncCommand);
    socket.on('playback:rate', handlePlaybackRate);
    socket.on('playback:loop', handlePlaybackLoop);
    socket.on('playback:tsmap', handleTsMap);
    return () => {
      socket.off('sync:command', handleSyncCommand);
      socket.off('playback:rate', handlePlaybackRate);
      socket.off('playback:loop', handlePlaybackLoop);
      socket.off('playback:tsmap', handleTsMap);
    };
  }, [roomIdFromStore, applyRemoteState]);

  const playbackVersion = useRoomStore((s) => s.room?.playback.version ?? 0);
  useEffect(() => {
    if (!playerReady || !roomIdFromStore || playbackVersion === 0) return;
    const state = useRoomStore.getState();
    const playback = state.room?.playback;
    if (!playback || playback.baseServerTime <= 0) return;
    const myUserId = state.currentUser?.id;
    if (myUserId && playback.updatedBy === myUserId) return;
    if (playback.status === 'playing' || playback.baseTime === 0) {
      videoEndedRef.current = false;
      setVideoEnded(false);
    }
    const targetTime = computeExpectedRoomTime(
      { baseTime: playback.baseTime, baseServerTime: playback.baseServerTime, status: playback.status },
      state.serverOffsetMs,
    );
    applyRemoteState(
      playback.status as 'playing' | 'paused' | 'idle',
      Math.max(0, targetTime),
      700,
    );
  }, [playbackVersion, playerReady, roomIdFromStore, applyRemoteState]);

  // Subtitle loading from room state or subtitle:changed event
  const loadSubtitle = useCallback(async (src: string | null) => {
    const video = videoRef.current;
    if (!video) return;
    // remove previous tracks
    while (video.querySelector('track')) {
      video.querySelector('track')?.remove();
    }
    if (!src) return;
    try {
      let trackSrc = src;
      if (src.toLowerCase().endsWith('.srt')) {
        const resp = await fetch(src);
        const blob = await resp.blob();
        trackSrc = await toWebVTT(blob);
      }
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'Altyazı';
      track.srclang = 'tr';
      track.src = trackSrc;
      track.default = true;
      video.appendChild(track);
      if (track.track) track.track.mode = 'showing';
    } catch {
      // ignore subtitle load errors
    }
  }, []);

  useEffect(() => {
    const rid = roomIdFromStore;
    if (!rid) return;
    const socket = getSocket();
    const handleSubtitleChanged = (data: { subtitleUrl: string | null }) => {
      loadSubtitle(data.subtitleUrl);
    };
    socket.on('subtitle:changed', handleSubtitleChanged);
    return () => { socket.off('subtitle:changed', handleSubtitleChanged); };
  }, [roomIdFromStore, loadSubtitle]);

  useEffect(() => {
    const subtitle = useRoomStore.getState().room?.playback.subtitle;
    if (subtitle !== undefined) loadSubtitle(subtitle ?? null);
  }, [roomIdFromStore, loadSubtitle]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (onReadyTimeoutRef.current) clearTimeout(onReadyTimeoutRef.current);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, []);

  return (
    <div className="relative w-full h-full group">
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        controls
        playsInline
      />
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10 pointer-events-none">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}
      {playerReady && !buffering && !videoEnded && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-3 left-3 z-10 pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md text-white transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-lg"
          title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
        >
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
      )}
      {videoEnded && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm z-20 pointer-events-auto animate-fade-in">
          <div className="text-center px-6">
            <div className="text-5xl mb-3 animate-float">🎬</div>
            <p className="text-text-main text-lg font-bold">Video bitti</p>
            <p className="text-text-muted text-sm mt-2 font-semibold">
              Yeni bir medya başlatmak için adminin/odanın sahibinin yeni bir URL eklemesi gerek.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
