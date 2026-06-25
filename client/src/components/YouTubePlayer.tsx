import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';
import { computeExpectedRoomTime, calculateMedian } from '../lib/time';

interface YouTubePlayerProps {
  videoId: string | null;
}

// YouTube IFrame Player API SDK ile senkron oynatıcı (Faz 1 — sync düzeltmesi).
//
// Önceki sürüm raw postMessage + enablejsapi kullanıyordu; kodun kendi
// yorumları bu olayların ngrok/localhost'ta "asla gelmediğini" itiraf
// ediyordu → sync tamamen ölü. Üstelik yerel süre serbest-sayan bir sayaçtı
// (her 250ms +0.25) ve gerçek getCurrentTime() HİÇ okunmuyordu → sync
// saatleri senkronize ediyordu, video konumlarını değil.
//
// Bu sürüm resmi YT.Player SDK'yı kullanır (onReady/onStateChange güvenilir),
// GERÇEK getCurrentTime() değerini 500ms'de bir okur, her saniye sunucuya
// heartbeat olarak gönderir, sunucudan gelen playback:tsmap ile lider
// (admin) konumuna göre drift düzeltir (dynamic playback rate 1.0→1.1x).
// Admin native timeline'ı sararsa jump detection bunu yakalayıp gerçek
// hedef zamanla playback:seek emit eder.
//
// Kontrol modeli: admin/owner oynat/duraklat/atla yapar (sunucu-gate'li).
// Member native kontroller yerel kalır, emit edilmez; drift düzeltme onları
// lidere geri çeker (bozuk reassert loop yerine).
export default function YouTubePlayer({ videoId }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const roomIdRef = useRef<string | undefined>();
  const addToastRef = useRef<(msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void>();

  // Keep refs in sync with latest store/state values
  const roomIdFromStore = useRoomStore((s) => s.room?.id);
  roomIdRef.current = roomIdFromStore;
  const addToast = useUIStore((s) => s.addToast);
  addToastRef.current = addToast;
  const meta = useRoomStore((s) => s.meta);

  const [buffering, setBuffering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [uiPlaying, setUiPlaying] = useState(false);
  const [uiTime, setUiTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // --- Senkron state (refs — kalıcı listener erişimi için) ---
  // Gerçek oynatma zamanı (getCurrentTime poll'undan anchor). Serbest sayaç DEĞİL.
  const realTimeRef = useRef(0); // son poll'dan gelen gerçek getCurrentTime
  const realTimeAtRef = useRef(0); // realTimeRef'in okunduğu Date.now() (interpolasyon)
  const videoDuration = useRef<number | null>(null);
  const applyingRemoteUpdate = useRef(false);
  const remoteGuardUntil = useRef(0); // onStateChange echo'larını bastır (bounce guard)
  const ytDebounce = useRef(true); // 500ms lockout (watchparty)
  const initialSyncDone = useRef(false);
  const lastSeekCheckTime = useRef(0); // admin seek-jump detection için
  const lastSeekCheckRealTime = useRef(0);
  const lastAppliedPlaybackRate = useRef(1); // drift düzeltme / fixed rate dedup
  const loopEnabled = useRef(false); // playback:loop state
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoEndedRef = useRef(false);

  // SDK scriptini bir kez yükle. window.onYouTubeIframeAPIReady tek seferlik
  // global callback — birden fazla component instance'u varsa sadece ilki
  // çağrılır. Promise ile sarmalayıp herkesin beklemesini sağlıyoruz.
  const ytReadyPromiseRef = useRef<Promise<void> | null>(null);
  const loadYouTubeSDK = useCallback((): Promise<void> => {
    if (ytReadyPromiseRef.current) return ytReadyPromiseRef.current;
    ytReadyPromiseRef.current = new Promise<void>((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.append(tag);
    });
    return ytReadyPromiseRef.current;
  }, []);

  // Gerçek getCurrentTime — interpolasyonlu (≤500ms eski poll'a anchor).
  // Serbest sayaç DEĞİL: gerçek YouTube pozisyonuna bağlı.
  const getLiveTime = useCallback((): number => {
    const player = playerRef.current;
    if (!player) return realTimeRef.current;
    try {
      // SDK her zaman gerçek değeri döndürür; poll'lar arası pürüzsüzlük için
      // interpolasyon ekle ama 500ms'yi aşmasın (buffering'de sapmasın).
      const base = realTimeRef.current;
      const since = (Date.now() - realTimeAtRef.current) / 1000;
      const roomStatus = useRoomStore.getState().roomPlaybackStatus;
      if (roomStatus === 'playing' && since < 0.6) {
        return base + since * lastAppliedPlaybackRate.current;
      }
      return base;
    } catch {
      return realTimeRef.current;
    }
  }, []);

  // --- Player komut yardımcıları (SDK doğrudan çağrı) ---
  const safeCall = useCallback(<T,>(fn: () => T): T | undefined => {
    const player = playerRef.current;
    if (!player) return undefined;
    try {
      return fn();
    } catch {
      return undefined;
    }
  }, []);

  const startPlayback = useCallback(() => {
    safeCall(() => playerRef.current?.playVideo());
    setUiPlaying(true);
  }, [safeCall]);

  const pausePlayback = useCallback(() => {
    safeCall(() => playerRef.current?.pauseVideo());
    setUiPlaying(false);
  }, [safeCall]);

  const seekTo = useCallback((time: number) => {
    if (!Number.isFinite(time) || time < 0) return;
    safeCall(() => playerRef.current?.seekTo(time, true));
    realTimeRef.current = time;
    realTimeAtRef.current = Date.now();
  }, [safeCall]);

  // --- Merkezi remote state uygulayıcı (hem event-driven hem poll'da) ---
  // Bounce guard: önce roomPlaybackStatus set edilir, sonra player'a komut
  // verilir; böylece onStateChange echo'su re-emit etmez.
  const applyRemoteState = useCallback((
    status: 'playing' | 'paused' | 'idle',
    time: number,
    guardMs: number = 700,
  ) => {
    applyingRemoteUpdate.current = true;
    remoteGuardUntil.current = Date.now() + guardMs;
    useRoomStore.getState().setRoomPlaybackStatus(status);
    seekTo(Math.max(0, time));
    if (status === 'playing') {
      startPlayback();
      setBuffering(false);
    } else {
      pausePlayback();
      setBuffering(false);
    }
    // Catch-up rate'i sıfırla; liderin rate'i 1.0x
    if (lastAppliedPlaybackRate.current !== 1) {
      safeCall(() => playerRef.current?.setPlaybackRate(1));
      lastAppliedPlaybackRate.current = 1;
    }
    // Guard penceresi bitince applyingRemoteUpdate false; ama seek sonrası
    // BUFFERING uzun sürerse, BUFFERING onStateChange handler'ı guard'ı
    // otomatik uzatır (kendi kendine resync döngüsünü kırar).
    setTimeout(() => { applyingRemoteUpdate.current = false; }, guardMs);
  }, [seekTo, startPlayback, pausePlayback, safeCall]);

  // Guard penceresini uzat (seek sonrası buffering'de kullanılır).
  const extendRemoteGuard = useCallback((extraMs: number) => {
    remoteGuardUntil.current = Math.max(remoteGuardUntil.current, Date.now() + extraMs);
  }, []);

  // Admin liderinin gerçek konumuna zorla resync (hard seek + play/pause).
  const resyncToLeader = useCallback(() => {
    const state = useRoomStore.getState();
    const roomStatus = state.roomPlaybackStatus;
    const tsMap = state.tsMap;
    const adminId = state.adminUserId;
    let leader = 0;
    if (adminId && typeof tsMap[adminId] === 'number') {
      leader = tsMap[adminId];
    } else if (Object.values(tsMap).length > 0) {
      leader = Object.values(tsMap).length > 2
        ? calculateMedian(Object.values(tsMap))
        : Math.max(...Object.values(tsMap));
    } else if (state.room?.playback) {
      // tsMap boşsa authoritative state'ten extrapolate
      leader = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
    }
    if (leader <= 0 && roomStatus === 'idle') return;
    applyRemoteState(roomStatus, leader, 900);
  }, [applyRemoteState]);

  // Gerçek player konumunun liderden ne kadar sapmış olduğunu ölç (onStateChange
  // ve poll'da hızlı karar vermek için). threshold: saniye cinsinden kabul edilebilir
  // maks sapma. Hem geride hem ileride olmak "out of sync" sayılır.
  const isOutOfSync = useCallback((thresholdSeconds: number): boolean => {
    const player = playerRef.current;
    if (!player) return false;
    const currentTime = safeCall(() => player.getCurrentTime()) ?? 0;
    const state = useRoomStore.getState();
    const tsMap = state.tsMap;
    const adminId = state.adminUserId;
    let leader: number | undefined;
    if (adminId && typeof tsMap[adminId] === 'number') {
      leader = tsMap[adminId];
    } else if (Object.values(tsMap).length > 0) {
      leader = Object.values(tsMap).length > 2
        ? calculateMedian(Object.values(tsMap))
        : Math.max(...Object.values(tsMap));
    } else if (state.room?.playback) {
      leader = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
    }
    if (typeof leader !== 'number') return false;
    return Math.abs(currentTime - leader) > thresholdSeconds;
  }, [safeCall]);

  // --- Custom fullscreen (container div) — YouTube fs=0; "More videos" paneli
  // çıkmasın diye YouTube'un kendi fullscreen'ı kapalı, container'ı fullscreen ederiz. ---
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

  // --- Odaya/role live erişim için yardımcılar ---
  const iAmAdmin = useCallback((): boolean => {
    const role = useRoomStore.getState().currentUser?.role;
    return role === 'owner' || role === 'admin';
  }, []);

  // --- Player kurulumu: SDK yükle → YT.Player oluştur (videoId değişince重建) ---
  useEffect(() => {
    let cancelled = false;
    if (!videoId) {
      // Temizle
      if (playerRef.current) {
        try { playerRef.current?.destroy?.(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      setPlayerReady(false);
      useRoomStore.getState().setPlayerReady(false);
      initialSyncDone.current = false;
      videoEndedRef.current = false;
      setVideoEnded(false);
      return;
    }

    // Reset state for new video
    setPlayerReady(false);
    setBuffering(false);
    setVideoEnded(false);
    videoEndedRef.current = false;
    initialSyncDone.current = false;
    realTimeRef.current = 0;
    realTimeAtRef.current = Date.now();
    videoDuration.current = null;
    lastAppliedPlaybackRate.current = 1;

    // 5s safety timeout (SDK onReady gelmezse fallback pull)
    if (onReadyTimeoutRef.current) clearTimeout(onReadyTimeoutRef.current);
    onReadyTimeoutRef.current = setTimeout(() => {
      if (initialSyncDone.current) return;
      const rid = roomIdRef.current;
      if (rid) getSocket().emit('sync:request', { roomId: rid, localTime: 0, playerState: 'desynced' });
    }, 5000);

    loadYouTubeSDK().then(() => {
      if (cancelled || !playerDivRef.current) return;
      // Eski player'ı temizle (yeni video)
      if (playerRef.current) {
        try { playerRef.current?.destroy?.(); } catch { /* ignore */ }
        playerRef.current = null;
      }

      const origin = window.location.origin;
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        videoId,
        // widget_referrer @types/youtube'da yok ama YouTube runtime'da destekler;
        // origin güvenliği için. Tip-dışı alanı any ile ekliyoruz.
        playerVars: {
          enablejsapi: 1,
          origin,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          autoplay: 0,
          controls: 1, // native YouTube arayüzü (duraklat/slider/kalite/altyazı)
          fs: 0, // YouTube'un kendi fullscreen'ı kapalı (container fullscreen kullanırız)
          playsinline: 1,
          widget_referrer: origin,
        } as YT.PlayerVars,
        events: {
          onReady: () => {
            if (cancelled) return;
            if (onReadyTimeoutRef.current) { clearTimeout(onReadyTimeoutRef.current); onReadyTimeoutRef.current = null; }
            setPlayerReady(true);
            useRoomStore.getState().setPlayerReady(true);
            setBuffering(false);
            const dur = safeCall(() => playerRef.current?.getDuration()) ?? 0;
            if (dur > 0) videoDuration.current = dur;

            // Initial sync: store'daki playback state'ten hedef konumu çöz.
            // Mevcut oda durumu (geç katılan / sayfa yenileme) doğru konuma seek.
            const state = useRoomStore.getState();
            const playback = state.room?.playback;
            const rid = roomIdRef.current;
            initialSyncDone.current = true;
            if (playback?.videoId && playback.baseServerTime > 0) {
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
          },
          onStateChange: (e: YT.OnStateChangeEvent) => {
            if (cancelled) return;
            const st = e.data;
            const roomStatus = useRoomStore.getState().roomPlaybackStatus;
            const admin = iAmAdmin();
            const guardActive = Date.now() < remoteGuardUntil.current;

            // videoEnded — SDK ENDED'i güvenilir teslim eder (raw postMessage'dan farklı)
            if (st === YT.PlayerState.ENDED) {
              if (loopEnabled.current) {
                videoEndedRef.current = false;
                setVideoEnded(false);
                applyRemoteState('playing', 0, 500);
                return;
              }
              videoEndedRef.current = true;
              setVideoEnded(true);
              setUiPlaying(false);
              setBuffering(false);
              // Auto-advance playlist: admin ise listedekine geç
              if (admin) {
                const rid = roomIdRef.current;
                if (rid) getSocket().emit('playlist:next', { roomId: rid });
              }
              return;
            }
            if (st === YT.PlayerState.CUED) {
              setBuffering(false);
              return;
            }
            if (st === YT.PlayerState.BUFFERING) {
              // Buffering overlay sadece oda gerçekten oynuyorken gösterilir.
              // Admin pause yaptığında roomStatus 'paused' olur → overlay kapanır.
              // Ayrıca remote guard açıkken (seek sonrası) overlay gösterme;
              // guard bitene kadar bekleyip gerçek buffering ise sonra göster.
              if (roomStatus === 'playing' && !guardActive) {
                setBuffering(true);
                useRoomStore.getState().setSyncStatus('buffering');
              }
              // Seek sonrası uzun buffering'de resync loop'unu kır: guard uzat.
              extendRemoteGuard(700);
              const rid = roomIdRef.current;
              if (rid) getSocket().emit('client:buffering', { roomId: rid });
              return;
            }
            if (st === YT.PlayerState.PLAYING) {
              setBuffering(false);
              videoEndedRef.current = false;
              setVideoEnded(false);
              setUiPlaying(true);
              if (admin) {
                // Bounce guard: SADECE player durumu oda durumuyla UYUŞMADIĞINDA
                // emit et. Remote play geldiğinde roomPlaybackStatus zaten 'playing'
                // → echo re-emit etmez. Yerel admin play'e bastıysa → emit.
                if (!guardActive && ytDebounce.current && roomStatus !== 'playing') {
                  ytDebounce.current = false;
                  const rid = roomIdRef.current;
                  if (rid) {
                    const t = safeCall(() => playerRef.current?.getCurrentTime()) ?? 0;
                    getSocket().emit('playback:play', {
                      roomId: rid,
                      currentTime: t,
                      clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    });
                  }
                  useRoomStore.getState().setRoomPlaybackStatus('playing');
                  setTimeout(() => { ytDebounce.current = true; }, 500);
                }
              } else {
                // Member: oda durumu playing değilse (admin pause yapmış) hemen
                // resync. Konum farkı için 4sn threshold (seek sonrası normal
                // buffering/seek süresi içinde tetiklenmesin).
                if (!guardActive && (roomStatus !== 'playing' || isOutOfSync(4))) {
                  resyncToLeader();
                }
              }
              return;
            }
            if (st === YT.PlayerState.PAUSED) {
              setUiPlaying(false);
              setBuffering(false); // admin pause'da buffering yazısı kalmasın
              if (admin) {
                if (!guardActive && ytDebounce.current && roomStatus === 'playing') {
                  ytDebounce.current = false;
                  const rid = roomIdRef.current;
                  if (rid) {
                    const t = safeCall(() => playerRef.current?.getCurrentTime()) ?? 0;
                    getSocket().emit('playback:pause', {
                      roomId: rid,
                      currentTime: t,
                      clientEventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    });
                  }
                  useRoomStore.getState().setRoomPlaybackStatus('paused');
                  setTimeout(() => { ytDebounce.current = true; }, 500);
                }
              } else {
                // Member: oda hâlâ playing ise (admin durdurmadıysa) hemen resync.
                // Konum farkı için 4sn threshold.
                if (!guardActive && (roomStatus === 'playing' || isOutOfSync(4))) {
                  resyncToLeader();
                }
              }
              return;
            }
          },
          onError: (e: YT.OnErrorEvent) => {
            const toast = addToastRef.current;
            if (!toast) return;
            const code = e.data;
            if (code === 101 || code === 150) toast('Bu video gömülü oynatmaya izin vermiyor. Başka bir video deneyin.', 'error');
            else if (code === 100) toast('Bu video bulunamadı veya kaldırılmış.', 'error');
            else if (code === 5) toast('Video oynatılamadı. YouTube hesabınıza giriş yapıp tekrar deneyin.', 'error');
            else toast('Video yüklenirken bir hata oluştu.', 'error');
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (onReadyTimeoutRef.current) { clearTimeout(onReadyTimeoutRef.current); onReadyTimeoutRef.current = null; }
    };
  }, [videoId, loadYouTubeSDK, safeCall, seekTo, startPlayback, pausePlayback, iAmAdmin]);

  // --- 500ms GERÇEK getCurrentTime poll'u + admin seek-jump detection ---
  // Serbest sayacın yerine: gerçek YouTube pozisyonunu okur, drift referansı
  // ve UI zamanı bunu kullanır. Admin seek'i jump olarak yakalar.
  useEffect(() => {
    if (!playerReady || !videoId) {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    lastSeekCheckTime.current = Date.now();
    lastSeekCheckRealTime.current = 0;

    pollTimerRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const real = safeCall(() => player.getCurrentTime());
      if (typeof real !== 'number') return;

      const nowMs = Date.now();
      const state = useRoomStore.getState();
      const roomStatus = state.roomPlaybackStatus;
      const admin = iAmAdmin();

      // Lider zamanını çöz (admin varsa admin, yoksa median/max)
      const tsMap = state.tsMap;
      const adminId = state.adminUserId;
      let leaderTime: number | undefined;
      if (adminId && typeof tsMap[adminId] === 'number') {
        leaderTime = tsMap[adminId];
      } else if (Object.values(tsMap).length > 0) {
        leaderTime = Object.values(tsMap).length > 2
          ? calculateMedian(Object.values(tsMap))
          : Math.max(...Object.values(tsMap));
      } else if (state.room?.playback) {
        leaderTime = computeExpectedRoomTime(state.room.playback, state.serverOffsetMs);
      }
      const drift = typeof leaderTime === 'number' ? real - leaderTime : 0;
      const absDrift = Math.abs(drift);

      if (admin) {
        // --- Admin seek-jump detection (kök neden B düzeltmesi) ---
        // Native timeline sürüklenince onStateChange target zamanı vermez;
        // gerçek getCurrentTime'daki büyük zıplama seek'i ele verir.
        if (
          !applyingRemoteUpdate.current &&
          lastSeekCheckRealTime.current > 0 &&
          roomStatus === 'playing'
        ) {
          const elapsed = (nowMs - lastSeekCheckTime.current) / 1000;
          const expectedDelta = elapsed * lastAppliedPlaybackRate.current;
          const actualDelta = real - lastSeekCheckRealTime.current;
          const jump = Math.abs(actualDelta - expectedDelta);
          if (jump > 2.0) {
            const rid = roomIdRef.current;
            if (rid) {
              getSocket().emit('playback:seek', {
                roomId: rid,
                targetTime: Math.max(0, real),
                shouldPlay: true,
                clientEventId: `evt_${nowMs}_${Math.random().toString(36).slice(2)}`,
              });
            }
          }
        }

        // Admin kendi lideridir: tsMap'e göre kendi kendine resync etmemeli.
        // Sadece seek-jump detection (yukarıda) ve hafif geride kalma durumunda
        // rate ile yakala. Admin zaten authoritative state'i belirler.
        if (!applyingRemoteUpdate.current && roomStatus === 'playing' && typeof leaderTime === 'number' && drift < 0) {
          // admin kendi konumu liderden (kendi) gerideyse hafif hızlandır
          if (absDrift > 0.5 && absDrift <= 3) {
            const pbr = Math.min(1 + absDrift / 10, 1.1);
            if (Math.abs(pbr - lastAppliedPlaybackRate.current) > 0.001) {
              safeCall(() => player.setPlaybackRate(pbr));
              lastAppliedPlaybackRate.current = pbr;
            }
          } else if (absDrift <= 0.3 && lastAppliedPlaybackRate.current !== 1) {
            safeCall(() => player.setPlaybackRate(1));
            lastAppliedPlaybackRate.current = 1;
          }
        }
      } else {
        // --- Member: lider ile durum veya konum farkı varsa zorla resync ---
        // Member'in kendi pause/seek/play denemelerine izin verme.
        if (!applyingRemoteUpdate.current) {
          const playerState = safeCall(() => player.getPlayerState());
          const playerPlaying = playerState === YT.PlayerState.PLAYING;
          const roomPlaying = roomStatus === 'playing';
          const stateMismatch = playerPlaying !== roomPlaying;
          const tooFar = typeof leaderTime === 'number' && absDrift > 4;
          if (stateMismatch || tooFar) {
            resyncToLeader();
          } else if (roomPlaying && typeof leaderTime === 'number') {
            // Hafif drift: yavaşça rate ile yakala (1.0→1.1x)
            if (absDrift > 0.5 && drift < 0) {
              const pbr = Math.min(1 + absDrift / 10, 1.1);
              if (Math.abs(pbr - lastAppliedPlaybackRate.current) > 0.001) {
                safeCall(() => player.setPlaybackRate(pbr));
                lastAppliedPlaybackRate.current = pbr;
              }
            } else if (absDrift <= 0.3 && lastAppliedPlaybackRate.current !== 1) {
              safeCall(() => player.setPlaybackRate(1));
              lastAppliedPlaybackRate.current = 1;
            }
          }
        }
      }
      lastSeekCheckTime.current = nowMs;
      lastSeekCheckRealTime.current = real;

      // Gerçek zamanı anchor'la (UI + drift referansı)
      realTimeRef.current = real;
      realTimeAtRef.current = nowMs;
      setUiTime(real);
      setUiPlaying(roomStatus === 'playing');

      // Admin pause durumunda buffering overlay'i asla gösterme
      if (roomStatus !== 'playing' && buffering) setBuffering(false);

      // Süre (meta birincil, SDK yedek)
      if (videoDuration.current == null) {
        const dur = safeCall(() => player.getDuration()) ?? 0;
        if (dur > 0) videoDuration.current = dur;
      }

      // Video sonu (süre bazlı yedek — SDK ENDED zaten güvenilir ama burada da tut)
      const dur = videoDuration.current;
      if (dur && dur > 0 && real >= dur - 0.5 && !videoEndedRef.current) {
        videoEndedRef.current = true;
        setVideoEnded(true);
      }
    }, 500);

    return () => { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } };
  }, [playerReady, videoId, safeCall, iAmAdmin]);

  // --- 1s heartbeat emit: GERÇEK getCurrentTime → sunucu tsMap ---
  // Remote guard penceresi açıkken (applyRemoteState/resync sonrası) heartbeat
  // atlatılır; aksi halde seek sırasında eski konum tsMap'e yazılıp diğer
  // client'lar yanlış lider konumu görür ve feedback loop oluşur.
  useEffect(() => {
    if (!playerReady || !roomIdFromStore) return;
    heartbeatTimerRef.current = setInterval(() => {
      if (applyingRemoteUpdate.current || Date.now() < remoteGuardUntil.current) return;
      const state = useRoomStore.getState();
      if (!state.room?.playback.videoId) return;
      const player = playerRef.current;
      if (!player) return;
      const real = safeCall(() => player.getCurrentTime());
      if (typeof real !== 'number') return;
      getSocket().emit('playback:heartbeat', {
        roomId: roomIdFromStore,
        currentTime: real,
      });
    }, 1000);
    return () => { if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; } };
  }, [playerReady, roomIdFromStore, safeCall]);

  // --- Leader zamanı: admin'in tsMap değeri (fallback median/max) ---
  const getLeaderTime = useCallback((): number => {
    const state = useRoomStore.getState();
    const tsMap = state.tsMap;
    const adminId = state.adminUserId;
    const values = Object.values(tsMap);
    if (adminId && typeof tsMap[adminId] === 'number') {
      return tsMap[adminId]; // admin tek lider (admin-authoritative model)
    }
    if (values.length === 0) return 0;
    if (values.length > 2) return calculateMedian(values);
    return Math.max(...values); // ≤2 viewer: en ilerideki lider (watchparty)
  }, []);

  // --- Drift düzeltme + SyncBadge: playback:tsmap listener ---
  useEffect(() => {
    const rid = roomIdFromStore;
    if (!rid) return;
    const socket = getSocket();

    const handleTsMap = (data: { tsMap: Record<string, number>; adminUserId: string | null }) => {
      const state = useRoomStore.getState();
      state.setTsMap(data.tsMap);
      if (data.adminUserId) state.setAdminUserId(data.adminUserId);

      if (!state.room?.playback.videoId) return;
      if (applyingRemoteUpdate.current) return;
      const roomStatus = state.roomPlaybackStatus;
      if (roomStatus !== 'playing') {
        // paused/idle — drift düzeltme kapalı, ama lider-farkı için badge güncelle
        updateSyncBadge(state, data.tsMap, data.adminUserId);
        return;
      }

      // Drift düzeltme artık 500ms poll'da yapılıyor (daha hızlı ve gerçek
      // player durumunu gözlemleyen). Burada sadece badge güncellemesi yeterli.
      updateSyncBadge(state, data.tsMap, data.adminUserId);
    };

    const updateSyncBadge = (
      state: ReturnType<typeof useRoomStore.getState>,
      tsMap: Record<string, number>,
      adminUserId: string | null,
    ) => {
      const myId = state.currentUser?.id;
      const myTime = myId ? tsMap[myId] : undefined;
      if (typeof myTime !== 'number') return;
      const leader = adminUserId && tsMap[adminUserId] != null
        ? tsMap[adminUserId]
        : (Object.values(tsMap).length > 2
            ? calculateMedian(Object.values(tsMap))
            : Math.max(...Object.values(tsMap)));
      const absDelta = Math.abs(leader - myTime);
      if (absDelta <= 1.5) useRoomStore.getState().setSyncStatus('synced');
      else if (absDelta <= 2.5) useRoomStore.getState().setSyncStatus('slightly-off');
      else useRoomStore.getState().setSyncStatus('resyncing');
    };

    socket.on('playback:tsmap', handleTsMap);
    return () => { socket.off('playback:tsmap', handleTsMap); };
  }, [roomIdFromStore, iAmAdmin, seekTo, startPlayback, safeCall]);

  // --- sync:command listener (initial-sync / sync-response / reassert) ---
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
      // rate === 0: auto sync (dynamic catch-up). >0: fixed shared rate.
      const fixedRate = data.rate;
      if (fixedRate > 0) {
        lastAppliedPlaybackRate.current = fixedRate;
        safeCall(() => playerRef.current?.setPlaybackRate(fixedRate));
      } else {
        // auto moda dönüş: 1.0x'e reset, dynamic catch-up poll'da devam eder
        lastAppliedPlaybackRate.current = 1;
        safeCall(() => playerRef.current?.setPlaybackRate(1));
      }
      useRoomStore.getState().updatePlayback({ playbackRate: fixedRate });
    };

    const handlePlaybackLoop = (data: { loop: boolean }) => {
      loopEnabled.current = data.loop;
      safeCall(() => playerRef.current?.setLoop(data.loop));
      useRoomStore.getState().updatePlayback({ loop: data.loop });
    };

    socket.on('sync:command', handleSyncCommand);
    socket.on('playback:rate', handlePlaybackRate);
    socket.on('playback:loop', handlePlaybackLoop);
    return () => {
      socket.off('sync:command', handleSyncCommand);
      socket.off('playback:rate', handlePlaybackRate);
      socket.off('playback:loop', handlePlaybackLoop);
    };
  }, [roomIdFromStore, seekTo, startPlayback, pausePlayback, safeCall]);

  // --- Version watch: playback:state (admin play/pause/seek) → diğerlerine uygula ---
  const playbackVersion = useRoomStore((s) => s.room?.playback.version ?? 0);
  useEffect(() => {
    if (!playerReady || !roomIdFromStore || playbackVersion === 0) return;
    const state = useRoomStore.getState();
    const playback = state.room?.playback;
    if (!playback?.videoId || playback.baseServerTime <= 0) return;
    const myUserId = state.currentUser?.id;
    // Değişikliği başlatan (admin) atla — kendi zaten o konumda
    if (myUserId && playback.updatedBy === myUserId) return;
    // Yeni oynatma başladı → videoEnded overlay'i kapat
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

  // --- meta → videoDuration (sunucu süresi birincil, SDK yedek) ---
  useEffect(() => {
    if (!meta) return;
    if (meta.videoId === useRoomStore.getState().room?.playback.videoId) {
      if (typeof meta.durationSeconds === 'number' && meta.durationSeconds > 0) {
        videoDuration.current = meta.durationSeconds;
      }
    }
  }, [meta]);

  // --- Manual "Beraber izlemeye devam et" butonu (gerçek konuma resync) ---
  const handleRejoinRoom = useCallback(() => {
    const leader = getLeaderTime();
    if (leader <= 0) {
      const rid = roomIdRef.current;
      if (rid) getSocket().emit('sync:request', { roomId: rid, localTime: getLiveTime(), playerState: 'desynced' });
      return;
    }
    const state = useRoomStore.getState();
    applyRemoteState(state.roomPlaybackStatus, leader, 900);
  }, [getLeaderTime, getLiveTime, applyRemoteState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (onReadyTimeoutRef.current) clearTimeout(onReadyTimeoutRef.current);
      if (playerRef.current) { try { playerRef.current?.destroy?.(); } catch { /* ignore */ } playerRef.current = null; }
    };
  }, []);

  if (!videoId) return null;

  return (
    <div ref={containerRef} className="relative w-full h-full group">
      {/* SDK iframe'i bu div'e inject edilir */}
      <div ref={playerDivRef} className="w-full h-full" />

      {/* Buffering overlay — native YouTube çubuğunun üzerinde */}
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10 pointer-events-none">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-main text-sm">Bağlantın videoyu yüklemeye çalışıyor...</p>
          </div>
        </div>
      )}

      {/* Kendi fullscreen butonumuz — sol üst köşede */}
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

      {/* Video bitti — YouTube "More videos" öneri panelini kaplayan overlay */}
      {videoEnded && !buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm z-20 pointer-events-auto animate-fade-in">
          <div className="text-center px-6">
            <div className="text-5xl mb-3 animate-float">🎬</div>
            <p className="text-text-main text-lg font-bold">Video bitti</p>
            <p className="text-text-muted text-sm mt-2 font-semibold">
              Yeni bir video başlatmak için adminin/odanın sahibinin yeni bir YouTube linki eklemesi gerek.
            </p>
            <button onClick={handleRejoinRoom}
              className="mt-4 px-5 py-2.5 bg-red-main text-white font-semibold rounded-xl
                glow-red hover:glow-red transition-all duration-300 hover:bg-red-soft active:scale-[0.98] shadow-lg">
              Senkronize et
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sync Badge — player DIŞINDA, player'ın hemen üstünde (RoomPage).
// Player içindeki native tuşları (kalite/altyazı/fullscreen) engellememesi
// için player container dışında render edilir.
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
  return (
    <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${color} backdrop-blur-sm transition-all duration-300 self-end`}>
      {label}
    </div>
  );
}
