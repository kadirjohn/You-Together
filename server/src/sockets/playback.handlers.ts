import type { Socket } from 'socket.io';
import type { Server as SocketIOServer } from 'socket.io';
import { roomRepository } from '../rooms/room.repository.js';
import {
  playbackEventSchema,
  seekEventSchema,
  syncRequestSchema,
  playerReadySchema,
  heartbeatSchema,
  playbackRateSchema,
  loopSchema,
  subtitleSchema,
  PlaybackStatus,
  RoomRole,
} from '../rooms/room.types.js';
import type { RoomPlaybackState } from '../rooms/room.types.js';
import { now, computeCurrentRoomTime } from '../utils/time.js';
import { getIO } from './socket.server.js';

const repo = roomRepository();

function broadcastToRoom(roomId: string, event: string, data: any) {
  getIO().to(roomId).emit(event, data);
}

// ---------------------------------------------------------------------------
// tsMap — per-odaa in-memory "gerçek konum" haritası (watchparty REC:tsMap).
//
// baseTime/baseServerTime ekstrapolasyonu authoritative oynatma durumunu
// (play/pause/seek) tutar ve admin-gate'lidir. tsMap ise her client'ın her
// saniye gönderdiği GERÇEK getCurrentTime() değerlerini tutar — drift
// düzeltme bunu kullanır (iki serbest-sayan saati karşılaştırmak yerine
// gerçek video konumlarını karşılaştırır).
//
// In-memory (Redis değil): 1 sn'lik ephemeral anlık görüntü. Sunucu yeniden
// başlınca sıfırlanır, sorun değil — client'lar bir sonraki heartbeat'te
// tsMap'i yeniden doldurur.
// ---------------------------------------------------------------------------
interface RoomTsMap {
  // { userId -> normalize edilmiş gerçek oynatma zamanı (saniye) }
  tsMap: Record<string, number>;
  // Son broadcast zamanı (normalize için: her heartbeat'te son-emit'ten
  // beri geçen süreyi çıkarırız, böylece 1 sn penceresinde toplanan
  // değerler karşılaştırılabilir olur — watchparty room.ts:805-824).
  lastEmit: number;
  // Leader (admin/owner) userId'si. Drift düzeltme lider konumuna göre.
  // playback.updatedBy'den çözülür; yoksa ownerUserId fallback.
  adminUserId: string | null;
}
const roomTsMaps = new Map<string, RoomTsMap>();

function getOrCreateRoomTsMap(roomId: string): RoomTsMap {
  let entry = roomTsMaps.get(roomId);
  if (!entry) {
    entry = { tsMap: {}, lastEmit: now(), adminUserId: null };
    roomTsMaps.set(roomId, entry);
  }
  return entry;
}

// Oda için lider (admin/owner) userId'sini çöz. Önce playback.updatedBy
// (son oynatma değiştiren kişi — admin kontrolü tutulduğu için genelde
// admin/owner), yoksa ownerUserId.
async function resolveAdminUserId(roomId: string): Promise<string | null> {
  const room = await repo.getRoom(roomId);
  if (!room) return null;
  const updatedBy = room.playback.updatedBy;
  if (updatedBy) return updatedBy;
  return room.ownerUserId ?? null;
}

// ---------------------------------------------------------------------------
// Periodic tsMap broadcaster — her saniye her aktif oda için tsMap'i
// herkese broadcast eder (watchparty room.ts:94-107). Stale entry'leri
// (artık odada olmayan kullanıcılar) prune eder. Boş odaları temizler.
// ---------------------------------------------------------------------------
let broadcasterTimer: ReturnType<typeof setInterval> | null = null;

export function startTsMapBroadcaster(io: SocketIOServer): void {
  if (broadcasterTimer) return; // zaten çalışıyor

  broadcasterTimer = setInterval(async () => {
    for (const [roomId, entry] of roomTsMaps.entries()) {
      try {
        // Odadaki kullanıcıları çek (Redis). disconnected olmayanlar.
        const users = await repo.getUsers(roomId);
        const memberIds = new Set(
          users.filter((u) => !(u as any).disconnectedAt).map((u) => u.id),
        );

        // Stale entry'leri prune
        for (const key of Object.keys(entry.tsMap)) {
          if (!memberIds.has(key)) delete entry.tsMap[key];
        }

        // Aktif video yoksa veya odada kimse yoksa atla (ve temizle)
        const room = await repo.getRoom(roomId);
        if (!room || !room.playback.videoId || memberIds.size === 0) {
          if (memberIds.size === 0) roomTsMaps.delete(roomId);
          continue;
        }

        entry.lastEmit = now();
        io.to(roomId).emit('playback:tsmap', {
          tsMap: entry.tsMap,
          adminUserId: entry.adminUserId,
        });
      } catch (err) {
        // Tek oda hatası tüm broadcaster'ı çökertmesin
        // (Redis geçici yavaşsa vs.)
      }
    }
  }, 1000);
}

export function stopTsMapBroadcaster(): void {
  if (broadcasterTimer) {
    clearInterval(broadcasterTimer);
    broadcasterTimer = null;
  }
}

// Oda silinince / boşalınca tsMap'i temizle (room.handlers çağırabilir).
export function clearRoomTsMap(roomId: string): void {
  roomTsMaps.delete(roomId);
}

export function registerPlaybackHandlers(socket: Socket) {
  // --- Playback: Play ---
  socket.on('playback:play', async (payload: unknown) => {
    const parsed = playbackEventSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, currentTime, clientEventId } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    // Yetkilendirme: pause/seek senkron olduğu için yalnızca owner/admin
    // oynatma durumunu değiştirebilir. Member reddedilir ve odanın gerçek
    // durumu bu socket'e geri assert edilir (sync:command → client snap-back).
    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      const targetTime = computeCurrentRoomTime(room.playback);
      socket.emit('sync:command', {
        type: 'reassert',
        videoId: room.playback.videoId,
        targetTime,
        status: room.playback.status,
        version: room.playback.version,
        serverTime: now(),
      });
      socket.emit('room:error', { message: 'Sadece admin oynat, duraklat veya atla yapabilir.' });
      return;
    }

    // Rate limit
    const key = `playback:${socket.id}`;
    const last = (socket.data as any)[key] || 0;
    if (now() - last < 200) return; // 200ms rate limit for playback events
    (socket.data as any)[key] = now();

    // currentTime 0 ise (ör. klavye space tuşu), mevcut extrapolated konumu
    // koru — play/pause konumu sıfırlamamalı.
    const effectiveTime = currentTime > 0
      ? currentTime
      : computeCurrentRoomTime(room.playback);

    const playback: RoomPlaybackState = {
      ...room.playback,
      status: PlaybackStatus.Playing,
      baseTime: effectiveTime,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: mapping.userId,
    };

    await repo.updatePlaybackState(roomId, playback);

    // Lider (admin) tsMap'e kendi gerçek konumunu yaz ki diğerleri ona
    // göre drift düzeltsin. Host-change reset (watchparty room.ts:536-562):
    // eski stale konumlar gelmesin diye tsMap'i temizle ve admin'le başlat.
    const entry = getOrCreateRoomTsMap(roomId);
    entry.adminUserId = mapping.userId;
    entry.tsMap = { [mapping.userId]: effectiveTime };
    entry.lastEmit = now();

    broadcastToRoom(roomId, 'playback:state', {
      status: playback.status,
      baseTime: playback.baseTime,
      baseServerTime: playback.baseServerTime,
      version: playback.version,
      updatedBy: mapping.userId,
      clientEventId,
      serverTime: now(),
    });
  });

  // --- Playback: Pause ---
  socket.on('playback:pause', async (payload: unknown) => {
    const parsed = playbackEventSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, currentTime, clientEventId } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    // Yetkilendirme: yalnızca owner/admin duraklatabilir. Member reddedilir.
    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      const targetTime = computeCurrentRoomTime(room.playback);
      socket.emit('sync:command', {
        type: 'reassert',
        videoId: room.playback.videoId,
        targetTime,
        status: room.playback.status,
        version: room.playback.version,
        serverTime: now(),
      });
      socket.emit('room:error', { message: 'Sadece admin oynat, duraklat veya atla yapabilir.' });
      return;
    }

    // currentTime 0 ise (ör. klavye space tuşu), mevcut extrapolated konumu koru.
    const effectiveTime = currentTime > 0
      ? currentTime
      : computeCurrentRoomTime(room.playback);

    const playback: RoomPlaybackState = {
      ...room.playback,
      status: PlaybackStatus.Paused,
      baseTime: effectiveTime,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: mapping.userId,
    };

    await repo.updatePlaybackState(roomId, playback);

    const entry = getOrCreateRoomTsMap(roomId);
    entry.adminUserId = mapping.userId;
    entry.tsMap = { [mapping.userId]: effectiveTime };
    entry.lastEmit = now();

    broadcastToRoom(roomId, 'playback:state', {
      status: playback.status,
      baseTime: playback.baseTime,
      baseServerTime: playback.baseServerTime,
      version: playback.version,
      updatedBy: mapping.userId,
      clientEventId,
      serverTime: now(),
    });
  });

  // --- Playback: Seek ---
  socket.on('playback:seek', async (payload: unknown) => {
    const parsed = seekEventSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, targetTime, shouldPlay, clientEventId } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    // Yetkilendirme: yalnızca owner/admin atlama yapabilir. Member reddedilir.
    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      const targetTime = computeCurrentRoomTime(room.playback);
      socket.emit('sync:command', {
        type: 'reassert',
        videoId: room.playback.videoId,
        targetTime,
        status: room.playback.status,
        version: room.playback.version,
        serverTime: now(),
      });
      socket.emit('room:error', { message: 'Sadece admin oynat, duraklat veya atla yapabilir.' });
      return;
    }

    const playback: RoomPlaybackState = {
      ...room.playback,
      status: shouldPlay ? PlaybackStatus.Playing : PlaybackStatus.Paused,
      baseTime: targetTime,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: mapping.userId,
    };

    await repo.updatePlaybackState(roomId, playback);

    // Seek sonrası tsMap'i reset: eski konumlar stale. Admin yeni konumla başlat.
    const entry = getOrCreateRoomTsMap(roomId);
    entry.adminUserId = mapping.userId;
    entry.tsMap = { [mapping.userId]: targetTime };
    entry.lastEmit = now();

    broadcastToRoom(roomId, 'playback:state', {
      status: playback.status,
      baseTime: playback.baseTime,
      baseServerTime: playback.baseServerTime,
      version: playback.version,
      updatedBy: mapping.userId,
      clientEventId,
      serverTime: now(),
    });
  });

  // --- Playback: Rate (admin/owner only) ---
  socket.on('playback:rate', async (payload: unknown) => {
    const parsed = playbackRateSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, rate } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin oynatma hızını değiştirebilir.' });
      return;
    }

    const playback: RoomPlaybackState = {
      ...room.playback,
      playbackRate: rate,
      updatedBy: mapping.userId,
    };
    await repo.updatePlaybackState(roomId, playback);

    broadcastToRoom(roomId, 'playback:rate', { rate });
  });

  // --- Playback: Loop (admin/owner only) ---
  socket.on('playback:loop', async (payload: unknown) => {
    const parsed = loopSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, loop } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin loop ayarını değiştirebilir.' });
      return;
    }

    const playback: RoomPlaybackState = {
      ...room.playback,
      loop,
      updatedBy: mapping.userId,
    };
    await repo.updatePlaybackState(roomId, playback);

    broadcastToRoom(roomId, 'playback:loop', { loop });
  });

  // --- Subtitle: Set (admin/owner only, mp4/hls için) ---
  socket.on('subtitle:set', async (payload: unknown) => {
    const parsed = subtitleSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, subtitleUrl } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin altyazı yükleyebilir.' });
      return;
    }

    const playback: RoomPlaybackState = {
      ...room.playback,
      subtitle: subtitleUrl,
      updatedBy: mapping.userId,
    };
    await repo.updatePlaybackState(roomId, playback);

    broadcastToRoom(roomId, 'subtitle:changed', { subtitleUrl });
  });

  // --- Playback: Heartbeat (client → server, GERÇEK getCurrentTime) ---
  // Her client her saniye player'ının gerçek pozisyonunu gönderir. Sunucu
  // bunu normalize ederek per-odaa tsMap'e yazar (watchparty room.ts:805-824).
  // 1 sn'de bir broadcaster herkese playback:tsmap broadcast eder.
  socket.on('playback:heartbeat', async (payload: unknown) => {
    const parsed = heartbeatSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, currentTime } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room || !room.playback.videoId) return;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const entry = getOrCreateRoomTsMap(roomId);
    // Lider kimliği çöz (henüz çözülmemişse). admin/owner = drift lideri.
    if (!entry.adminUserId) {
      entry.adminUserId = await resolveAdminUserId(roomId);
    }

    // Monotonik guard (watchparty room.ts:815): member'ın stale/geri konumu
    // lideri geri sürmesin. Admin kendi konumunu her zaman yazar (lider).
    const isAdmin = entry.adminUserId === mapping.userId;
    if (!isAdmin && room.playback.baseTime > 0) {
      // Member paused durumunda veya beklenenden çok gerideyse yazmaya gerek yok
      // (drift düzeltme zaten onu öne çekecek). Sadece makul aralıkta yaz.
      // Bu, buffering'de takılı kalan bir member'ın tsMap'i kirletmesini
      // önler. Lider konumu izle: member >= lider-30sn ise kabul et.
      const leaderTime = entry.adminUserId ? entry.tsMap[entry.adminUserId] : undefined;
      if (typeof leaderTime === 'number' && currentTime < leaderTime - 30) {
        return;
      }
    }

    // Normalize: 1 sn penceresinde toplanan heartbeat'leri karşılaştırılabilir
    // yap. Son broadcast'ten beri geçen süreyi çıkar, +1 ekle (broadcaster
    // ~1 sn içinde emit edecek) — watchparty room.ts:821-823.
    const timeSinceEmit = (now() - entry.lastEmit) / 1000;
    entry.tsMap[mapping.userId] = currentTime - timeSinceEmit + 1;
  });

  // --- Sync: Request ---
  socket.on('sync:request', async (payload: unknown) => {
    const parsed = syncRequestSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const targetTime = computeCurrentRoomTime(room.playback);

    socket.emit('sync:command', {
      type: 'sync-response',
      videoId: room.playback.videoId,
      targetTime,
      status: room.playback.status,
      version: room.playback.version,
      serverTime: now(),
    });
  });

  // --- Client: Player Ready ---
  socket.on('client:player-ready', async (payload: unknown) => {
    const parsed = playerReadySchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId } = parsed.data;
    const room = await repo.getRoom(roomId);
    if (!room) return;

    const targetTime = computeCurrentRoomTime(room.playback);

    socket.emit('sync:command', {
      type: 'initial-sync',
      videoId: room.playback.videoId,
      targetTime,
      status: room.playback.status,
      version: room.playback.version,
    });
  });

  // --- Client: Buffering ---
  socket.on('client:buffering', async (payload: unknown) => {
    const data = payload as { roomId?: string };
    if (!data?.roomId) return;
    // Server could track buffering users but MVP just acknowledges
  });

  // --- Client: Heartbeat (legacy, keeps lastSeenAt alive) ---
  socket.on('client:heartbeat', async (payload: unknown) => {
    // Keep socket alive, update lastSeenAt
    const { roomId } = (payload as any) || {};
    if (!roomId) return;
    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping) return;
    const user = await repo.getUser(roomId, mapping.userId);
    if (user) {
      user.lastSeenAt = now();
      const users = await repo.getUsers(roomId);
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx >= 0) {
        users[idx] = user;
        await repo.saveUsers(roomId, users);
      }
    }
  });
}
