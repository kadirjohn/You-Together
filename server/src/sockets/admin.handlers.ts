import type { Socket } from 'socket.io';
import { roomRepository } from '../rooms/room.repository.js';
import {
  adminGrantSchema,
  videoChangeSchema,
  RoomRole,
  PlaybackStatus,
} from '../rooms/room.types.js';
import type { RoomPlaybackState, RoomUser } from '../rooms/room.types.js';
import { extractYoutubeVideoId, fetchVideoMeta } from '../utils/youtube.js';
import { generateMessageId } from '../utils/ids.js';
import { now } from '../utils/time.js';
import { getIO } from './socket.server.js';

const repo = roomRepository();

function broadcastToRoom(roomId: string, event: string, data: any) {
  getIO().to(roomId).emit(event, data);
}

export function registerAdminHandlers(socket: Socket) {
  // --- Admin: Grant ---
  socket.on('admin:grant', async (payload: unknown) => {
    const parsed = adminGrantSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçersiz istek.' });
      return;
    }

    const { roomId, targetUserId } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Bu işlem için yetkiniz yok.' });
      return;
    }

    const target = await repo.getUser(roomId, targetUserId);
    if (!target) {
      socket.emit('room:error', { message: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (target.role === RoomRole.Owner) {
      socket.emit('room:error', { message: 'Owner zaten ana yönetici.' });
      return;
    }

    if (target.role === RoomRole.Admin) {
      socket.emit('room:error', { message: 'Kullanıcı zaten admin.' });
      return;
    }

    const updatedUsers = await repo.updateUserRole(roomId, targetUserId, RoomRole.Admin);
    if (!updatedUsers) return;

    broadcastToRoom(roomId, 'room:users:update', updatedUsers);
    broadcastToRoom(roomId, 'admin:updated', { userId: targetUserId, role: RoomRole.Admin });
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${target.displayName} admin yapıldı.`,
      createdAt: now(),
    });
  });

  // --- Admin: Revoke ---
  socket.on('admin:revoke', async (payload: unknown) => {
    const parsed = adminGrantSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçersiz istek.' });
      return;
    }

    const { roomId, targetUserId } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const requester = await repo.getUser(roomId, mapping.userId);
    if (!requester || (requester.role !== RoomRole.Owner && requester.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Bu işlem için yetkiniz yok.' });
      return;
    }

    const target = await repo.getUser(roomId, targetUserId);
    if (!target) {
      socket.emit('room:error', { message: 'Kullanıcı bulunamadı.' });
      return;
    }

    if (target.role === RoomRole.Owner) {
      socket.emit('room:error', { message: 'Owner yetkisi alınamaz.' });
      return;
    }

    if (target.role !== RoomRole.Admin) {
      socket.emit('room:error', { message: 'Kullanıcı zaten admin değil.' });
      return;
    }

    const updatedUsers = await repo.updateUserRole(roomId, targetUserId, RoomRole.Member);
    if (!updatedUsers) return;

    broadcastToRoom(roomId, 'room:users:update', updatedUsers);
    broadcastToRoom(roomId, 'admin:updated', { userId: targetUserId, role: RoomRole.Member });
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${target.displayName} adminlikten alındı.`,
      createdAt: now(),
    });
  });

  // --- Video: Change ---
  socket.on('video:change', async (payload: unknown) => {
    const parsed = videoChangeSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçerli bir YouTube linki gir.' });
      return;
    }

    const { roomId, youtubeUrl } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user) return;

    // Only owner and admin can change video
    if (user.role !== RoomRole.Owner && user.role !== RoomRole.Admin) {
      socket.emit('room:error', { message: 'Video değiştirme yetkiniz yok.' });
      return;
    }

    // Rate limit video changes
    const vKey = `videochange:${socket.id}`;
    const timestamps: number[] = (socket.data as any)[vKey] || [];
    const nowTime = now();
    timestamps.push(nowTime);
    const recent = timestamps.filter((t) => nowTime - t < 10_000);
    (socket.data as any)[vKey] = recent;
    if (recent.length > 3) {
      socket.emit('room:error', { message: 'Çok sık video değiştiriyorsunuz. Biraz bekleyin.' });
      return;
    }

    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      socket.emit('room:error', { message: 'Geçerli bir YouTube linki gir.' });
      return;
    }

    // Sunucu-taraflı metadata (süre + başlık + kanal). Cache'li, API key opsiyonel.
    // Birkaç yüz ms sürebilir; admin video-change rate-limit (10sn/3) içinde kabul edilebilir.
    const meta = await fetchVideoMeta(videoId);

    const playback: RoomPlaybackState = {
      videoId,
      status: PlaybackStatus.Playing,
      baseTime: 0,
      baseServerTime: now(),
      version: 1,
      updatedBy: user.id,
    };

    await repo.updatePlaybackState(roomId, playback);

    // Watch list'e ekle (aynı video tekrar oynatılırsa en üste taşınır).
    const watchlist = await repo.addWatchedVideo(roomId, {
      videoId,
      title: meta.title,
      channel: meta.channel,
      durationSeconds: meta.durationSeconds,
      thumbnail: meta.thumbnail,
      addedBy: { id: user.id, displayName: user.displayName },
      addedAt: now(),
    });

    broadcastToRoom(roomId, 'video:changed', {
      videoId,
      changedBy: {
        id: user.id,
        displayName: user.displayName,
      },
      state: playback,
      meta,
    });

    // Tüm odaya güncellenmiş izlenen-videolar listesi.
    broadcastToRoom(roomId, 'video:watchlist', watchlist);

    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${user.displayName} yeni videoyu başlattı.`,
      createdAt: now(),
    });
  });
}
