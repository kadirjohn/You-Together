import type { Socket } from 'socket.io';
import { roomRepository } from '../rooms/room.repository.js';
import {
  playbackEventSchema,
  seekEventSchema,
  syncRequestSchema,
  playerReadySchema,
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

    const playback: RoomPlaybackState = {
      ...room.playback,
      status: PlaybackStatus.Playing,
      baseTime: currentTime,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: mapping.userId,
    };

    await repo.updatePlaybackState(roomId, playback);

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

    const playback: RoomPlaybackState = {
      ...room.playback,
      status: PlaybackStatus.Paused,
      baseTime: currentTime,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: mapping.userId,
    };

    await repo.updatePlaybackState(roomId, playback);

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

  // --- Client: Heartbeat ---
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
