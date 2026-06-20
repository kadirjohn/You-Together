import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { computeExpectedRoomTime } from '../lib/time';

const YT_ORIGIN = 'https://www.youtube.com';

interface YouTubePlayerProps {
  videoId: string | null;
}

// YouTube iframe embed with NATIVE YouTube controls.
// Her izleyici kendi penceresinde kalite/dil/altyazı değiştirebilir (yerel, senkronu
// bozmaz — onStateChange tetiklemez). Pause/seek senkron olduğundan yalnızca admin
// yapabilir — enforcement sunucu-taraflı: member pause/seek emit eder, sunucu reddeder
// ve sync:command ile odayı geri assert eder (client snap-back).
// YouTube's postMessage API (onReady, onStateChange, infoDelivery) is unreliable
// on ngrok/localhost — events never arrive. Strategy:
//   1. Native YouTube control bar (controls=1) — kalite/dil/altyazı yerel menü
//   2. Own time tracking via 250ms interval (replaces YouTube infoDelivery)
//   3. onStateChange → socket emit (playback:play/pause) herkes için; sunucu admin
//      değilse reddeder + sync:command ile geri çeker
//   4. Initial sync: timeout fallback → sync:request → sync:command (seekTo + play/pause)
//   5. Muted autoplay fallback for browser autoplay policy
//   6. controls=1: YouTube'un kendi arayüzü (duraklat/slider/kalite/altyazı/fullscreen)
export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const roomIdRef = useRef<string | undefined>();
  const addToastRef = useRef<(msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void>();
  const commandId = useRef(0);

  // Keep refs in sync with latest store/state values
  const roomIdFromStore = useRoomStore((s) => s.room?.id);
  roomIdRef.current = roomIdFromStore;
  const addToast = useUIStore((s) => s.addToast);
  addToastRef.current = addToast;
  // Sunucu-taraflı video metası (süre + başlık + kanal). Birincil süre kaynağı.
  const meta = useRoomStore((s) => s.meta);

  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [userManuallySeeked, setUserManuallySeeked] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);
  // Video bitti (state 0 / ended) — YouTube'un "More videos" öneri panelini
  // fiziksel kaplamak + tıklamayı engellemek için overlay gösteririz. Bu panel
  // cross-origin iframe içinde olduğundan tıklamayı yakalayıp video:change'e
  // çeviremeyiz; bunun yerine paneli gizler, video değişimini yalnızca
  // admin/owner VideoInputBar/WatchList üzerinden (zaten admin-gate'li) tutarız.
  const [videoEnded, setVideoEnded] = useState(false);
  const [uiPlaying, setUiPlaying] = useState(false);
  const [uiTime, setUiTime] = useState(0);
  // Kendi fullscreen durumumuz (container div'i fullscreen ederiz, iframe'i değil).
  // YouTube'un kendi fullscreen'ı fs=0 ile kapalı — oradan "More videos" paneli çıkıyordu.
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
  // Video bitti ref'i — 250ms interval'in stale-closure'ından etkilenmeden
  // süre bazlı video-sonu tespiti için (postMessage state 0 güvenilmez).
  const videoEndedRef = useRef(false);

  // Build embed URL once
  const embedUrl = useMemo(() => {
    if (!videoId) return '';
    const origin = encodeURIComponent(window.location.origin);
    // controls=1: YouTube'un native arayüzü (duraklat/slider/kalite/altyazı/dil).
    // fs=0: YouTube'un KENDİ fullscreen butonu kapalı. Sebep: YouTube fullscreen
    // modunda "More videos" öneri panelini (12 video) gösterir ve bu panel cross-origin
    // iframe içinde olduğundan gizlenemez. Bunun yerine fullscreen'i kendi container'ımızda
    // yaparız (iframe kapsayan div'i fullscreen eder) — o zaman YouTube "embed" modunda
    // kalır, fullscreen More videos paneli çıkmaz; native play/pause/kalite/altyazı korunur.
    // enablejsapi=1 sync için (postMessage). vq=hd1080 default kalite.
    return `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&origin=${origin}&widget_referrer=${origin}&modestbranding=1&rel=0&iv_load_policy=3&autoplay=0&controls=1&fs=0&vq=hd1080`;
  }, [videoId]);

  // Get live current time (interpolated from our own timer)
  const getLiveTime = useCallback((): number => {
    const ps = playerState.current;
    if (ps.playing && ps.lastTimeUpdate > 0) {
      return ps.currentTime + (Date.now() - ps.lastTimeUpdate) / 1000;
    }
    return ps.currentTime;
  }, []);

  // YouTube iframe'ına postMessage komutu gönderir — tek tek değil, küçük
  // bir kuyruk + dedup ile. Arka arkaya seekTo+playVideo+unMute gibi komutlar
  // YouTube player'ı çökertiyordu (siyah ekran + "An error occurred"). Aynı
  // func için arka arkaya gelen komutlardan en sonuncusunu tutarız (ör. çok
  // hızlı seekTo'lar birleşir) ve komutlar arasında ~120ms bırakırız ki player
  // nefes alsın. setImmediate-benzeri mikro-gecikme (setTimeout 0) komut
  // sırasını korur ama player'ı boğmaz.
  const commandQueue = useRef<{ func: string; args: any[] }[]>([]);
  const commandFlushScheduled = useRef(false);
  const flushCommands = useCallback(() => {
    commandFlushScheduled.current = false;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) { commandQueue.current = []; return; }
    // Aynı func'tan arka arkaya gelenleri en sonuncusuyla birleştir (sırayı koru).
    const deduped: { func: string; args: any[] }[] = [];
    for (const cmd of commandQueue.current) {
      const last = deduped[deduped.length - 1];
      if (last && last.func === cmd.func) {
        last.args = cmd.args; // aynı komut: en son argümanla değiştir
      } else {
        deduped.push({ ...cmd });
      }
    }
    commandQueue.current = [];
    for (const cmd of deduped) {
      const id = ++commandId.current;
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: cmd.func, args: cmd.args, id: `cmd_${id}` }),
        YT_ORIGIN,
      );
    }
  }, []);
  const sendCommand = useCallback((func: string, args: any[] = []) => {
    commandQueue.current.push({ func, args });
    if (commandFlushScheduled.current) return;
    commandFlushScheduled.current = true;
    setTimeout(flushCommands, 0);
  }, [flushCommands]);

  // Native player'da autoplay politika workaround'una (mute→play→unMute dansı)
  // gerek yok — controls=1 ile native play butonu var ve kullanıcı tıklayınca
  // video oynar. Bu fonksiyon yalnızca senkron amaçlı playVideo yapar; mute/unMute
  // dansı YouTube player'ı komut çakışmasında çökertiyordu (siyah ekran +
  // "An error occurred"). Sade ve tek komut.
  const startPlayback = useCallback(() => {
    sendCommand('playVideo');
    playerState.current.playing = true;
    playerState.current.lastTimeUpdate = Date.now();
    setUiPlaying(true);
    return true;
  }, [sendCommand]);

  // Kendi fullscreen toggle'ımız — container div'i fullscreen eder (iframe'i değil).
  // YouTube'un kendi fullscreen butonu fs=0 ile kapalı; oradan fullscreen "More videos"
  // öneri paneli çıkıyordu (cross-origin iframe, gizlenemez). Container fullscreen'da
  // YouTube embed modunda kalır, panel çıkmaz; native play/pause/kalite/altyazı korunur.
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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
      // Video sonu tespiti — postMessage (onStateChange state 0) ngrok/localhost'ta
      // güvenilmez olduğu için süre bazlı yedek: currentTime süreye ulaşınca
      // videoEnded overlay'i göster (YouTube "More videos" panelini kaplar).
      const live = getLiveTime();
      const dur = videoDuration.current;
      if (dur && dur > 0 && live >= dur - 0.5 && !videoEndedRef.current) {
        videoEndedRef.current = true;
        playerState.current.playing = false;
        setVideoEnded(true);
      }
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
          if (playback.status === 'playing') { startPlayback(); }
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
        // Pause/seek senkron olduğundan yalnızca admin oynatma durumunu sunucuya
        // emit eder. Member native pause/seek yaparsa emit edilmez — drift loop
        // member'ı oynatılan konuma geri çeker. Bu, sunucu reassert döngüsünü
        // (kararsız player / siyah ekran) önler. Listener bir kez attach
        // edildiği için rolü store'dan canlı okuruz (mount anındaki frozen
        // değer değil).
        const role = storeState.currentUser?.role;
        const canControl = role === 'owner' || role === 'admin';
        if (state === 0) {
          // Video bitti — YouTube "More videos" öneri panelini gösterir. Bu panel
          // cross-origin iframe içinde olduğundan tıklamayı yakalayamayız; bunun
          // yerine videoEnded overlay'i ile paneli fiziksel kaplar + tıklamayı
          // engelleriz. Video değişimi yalnızca admin/owner VideoInputBar/WatchList
          // üzerinden (sunucu admin-gate'li).
          playerState.current.playing = false; playerState.current.lastTimeUpdate = Date.now();
          videoEndedRef.current = true; setVideoEnded(true);
        } else if (state === 1) {
          setBuffering(false); setNeedsUserInteraction(false); setVideoEnded(false);
          videoEndedRef.current = false;
          playerState.current.playing = true;
          if (!applyingRemoteUpdate.current && canControl) {
            const rid = roomIdRef.current;
            if (rid) getSocket().emit('playback:play', { roomId: rid, currentTime: getLiveTime(), clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
          }
        } else if (state === 2) {
          playerState.current.playing = false; playerState.current.lastTimeUpdate = Date.now();
          if (!applyingRemoteUpdate.current && canControl) {
            const rid = roomIdRef.current;
            if (rid) getSocket().emit('playback:pause', { roomId: rid, currentTime: getLiveTime(), clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}` });
          }
        } else if (state === 3) {
          setBuffering(true); useRoomStore.getState().setSyncStatus('buffering'); playerState.current.playing = false;
          const rid = roomIdRef.current;
          if (rid) getSocket().emit('client:buffering', { roomId: rid });
        } else if (state === 5) {
          // Cued — yeni video yüklendi, ended overlay'i kapat.
          videoEndedRef.current = false; setVideoEnded(false);
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
    if (!videoId) { setPlayerReady(false); setNeedsUserInteraction(false); setVideoEnded(false); videoEndedRef.current = false; initialSyncDone.current = false; return; }
    setPlayerReady(false); setBuffering(false); setNeedsUserInteraction(false); setVideoEnded(false); videoEndedRef.current = false; initialSyncDone.current = false;
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
        if (data.status === 'playing') { startPlayback(); setUiPlaying(true); }
        else if (data.status === 'paused') { sendCommand('pauseVideo'); playerState.current.playing = false; setUiPlaying(false); setNeedsUserInteraction(false); }
        useRoomStore.getState().setLastRemoteVersion(data.version || 0);
        setUserManuallySeeked(false);
        lastLocalTime.current = playerState.current.currentTime;
        lastCheckTime.current = Date.now();
      } finally { setTimeout(() => { applyingRemoteUpdate.current = false; }, 500); }
    };
    socket.on('sync:command', handleSyncCommand);
    return () => { socket.off('sync:command', handleSyncCommand); };
  }, [roomIdFromStore, sendCommand, startPlayback]);

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
      // userManuallySeeked yalnızca admin için: admin kendi seek/pause'unu sunucuya
      // emit eder (oda durumu güncellenir, drift oluşmaz). Member native pause/seek
      // yaparsa emit edilmez (yukarıdaki gate) — drift loop onu geri çekmeli, bu
      // yüzden member için userManuallySeeked setlenmez (geri çekmeye engel olur).
      const myRole = state.currentUser?.role;
      const iAmAdmin = myRole === 'owner' || myRole === 'admin';
      if (jump > 3 && lastLocalTime.current > 0 && !isRemoteSyncing.current && iAmAdmin) { setUserManuallySeeked(true); }
      lastLocalTime.current = localTime; lastCheckTime.current = now;
      tickCount++;
      if (tickCount % 2 !== 0) return;
      if (userManuallySeeked && iAmAdmin) { useRoomStore.getState().setSyncStatus('slightly-off'); return; }
      const expectedTime = computeExpectedRoomTime(
        { baseTime: state.room.playback.baseTime, baseServerTime: state.room.playback.baseServerTime, status: state.room.playback.status },
        state.serverOffsetMs,
      );
      const drift = localTime - expectedTime;
      const absDrift = Math.abs(drift);
      if (absDrift <= 1.5) { useRoomStore.getState().setSyncStatus('synced'); return; }
      if (absDrift <= 2.5) { useRoomStore.getState().setSyncStatus('slightly-off'); return; }
      // Member native duraklatmış/sarmış olabilir: drift oda durumuna göre büyür.
      // Geri çek: seekTo + oda playing ise playVideo (member duraklatılmışken
      // oynatmaya döndür). Komutlar throttled sendCommand ile birleştiği için
      // seekTo+playVideo çakışması YouTube'u çökertmez. Admin pause broadcast'le
      // tüm odada paused olur → admin tarafında drift oluşmaz.
      const roomPlaying = state.room.playback.status === 'playing';
      if (absDrift <= 3) {
        useRoomStore.getState().setSyncStatus('slightly-off');
        isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
        sendCommand('seekTo', [expectedTime, true]);
        if (roomPlaying) { sendCommand('playVideo'); playerState.current.playing = true; }
        else { sendCommand('pauseVideo'); playerState.current.playing = false; }
        playerState.current.currentTime = expectedTime; playerState.current.lastTimeUpdate = Date.now();
        lastLocalTime.current = expectedTime; lastCheckTime.current = Date.now();
        setTimeout(() => { applyingRemoteUpdate.current = false; isRemoteSyncing.current = false; }, 1500);
        return;
      }
      useRoomStore.getState().setSyncStatus('resyncing');
      isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
      sendCommand('seekTo', [expectedTime, true]);
      if (roomPlaying) { sendCommand('playVideo'); playerState.current.playing = true; }
      else { sendCommand('pauseVideo'); playerState.current.playing = false; }
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
    // Yeni oynatma başladı (version arttı) — "Video bitti" overlay'i kapat.
    // Aynı videoId replay (WatchList'ten tekrar oynat) durumunda videoId
    // değişmediği için timeout fallback tetiklenmez; version artışı overlay'i
    // kapatır.
    if (playback.status === 'playing' || playback.baseTime === 0) {
      videoEndedRef.current = false; setVideoEnded(false);
    }
    const targetTime = computeExpectedRoomTime(
      { baseTime: playback.baseTime, baseServerTime: playback.baseServerTime, status: playback.status },
      state.serverOffsetMs,
    );
    isRemoteSyncing.current = true; applyingRemoteUpdate.current = true;
    sendCommand('seekTo', [targetTime, true]);
    playerState.current.currentTime = targetTime; playerState.current.lastTimeUpdate = Date.now();
    lastLocalTime.current = targetTime; lastCheckTime.current = Date.now();
    if (playback.status === 'playing') {
      startPlayback(); setUiPlaying(true);
      if (autoplayRetryTimer.current) clearTimeout(autoplayRetryTimer.current);
      autoplayRetryTimer.current = setTimeout(() => { if (!playerState.current.playing) setNeedsUserInteraction(true); }, 2000);
    } else if (playback.status === 'paused') {
      sendCommand('pauseVideo'); playerState.current.playing = false; setUiPlaying(false); setNeedsUserInteraction(false);
    }
    setUserManuallySeeked(false);
    setTimeout(() => { applyingRemoteUpdate.current = false; isRemoteSyncing.current = false; }, 1500);
  }, [playbackVersion]);

  const handleRejoinRoom = useCallback(() => {
    const rid = roomIdRef.current; if (!rid) return;
    applyingRemoteUpdate.current = true;
    getSocket().emit('sync:request', { roomId: rid, localTime: getLiveTime(), playerState: 'desynced' });
    setTimeout(() => { applyingRemoteUpdate.current = false; setUserManuallySeeked(false); }, 1000);
  }, [getLiveTime]);

  if (!videoId || !embedUrl) return null;

  return (
    <div ref={containerRef} className="relative w-full h-full group">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen"
        title="YouTube video player"
      />

      {/* Buffering overlay — native YouTube çubuğunun üzerinde, sadece yüklenirken */}
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10 pointer-events-none">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

      {/* Kendi fullscreen butonumuz — sol üst köşede (YouTube native sağ-üst kontrolleriyle
          çakışmaz). YouTube'un kendi fullscreen butonu fs=0 ile kapalı (oradan "More videos"
          paneli çıkıyordu). Container div'i fullscreen eder — YouTube embed modunda kalır,
          panel çıkmaz. pointer-events-auto, hover'da görünür. */}
      {playerReady && !buffering && !videoEnded && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-3 left-3 z-10 pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full
            bg-black/50 hover:bg-black/70 backdrop-blur-md text-white transition-all duration-200
            opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-lg"
          title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
          aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
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

      {/* Video bitti — YouTube'un "More videos" öneri panelini kaplayan overlay.
          Panel cross-origin iframe içinde olduğundan tıklamayı yakalayıp video:change'e
          çeviremeyiz; bu yüzden paneli fiziksel gizler + tıklamayı engelleriz
          (pointer-events-auto ile iframe'e iletilmez). Video değişimi yalnızca
          admin/owner VideoInputBar/WatchList üzerinden (sunucu admin-gate'li). */}
      {videoEnded && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm z-20 pointer-events-auto animate-fade-in">
          <div className="text-center px-6">
            <div className="text-5xl mb-3 animate-float">🎬</div>
            <p className="text-text-main text-lg font-bold">Video bitti</p>
            <p className="text-text-muted text-sm mt-2 font-semibold">
              Yeni bir video başlatmak için adminin/odanın sahibinin yeni bir YouTube linki eklemesi gerek.
            </p>
          </div>
        </div>
      )}

      {/* Manual seek rejoin button — member native timeline'ı sarayıp drift oluşunca */}
      {userManuallySeeked && !buffering && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 animate-fade-in">
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
    </div>
  );
}

// ============================================================
// Sync Badge — player DIŞINDA, player'ın hemen üstünde render edilir
// (RoomPage'de player container'ın üzerinde). Player içindeki native
// tuşları (kalite/altyazı/fullscreen) engellememesi için burada değil.
// ============================================================
export function SyncBadge() {
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
  // Player DIŞINDA, player'ın hemen üstünde render edilir (RoomPage).
  // absolute positioning yok — normal akışta, sağa yaslı inline badge.
  return (
    <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${color} backdrop-blur-sm transition-all duration-300 self-end`}>
      {label}
    </div>
  );
}
