import type { Socket } from 'socket.io';
import { getIO } from './socket.server.js';
import { roomRepository } from '../rooms/room.repository.js';
import {
  createRoomSchema,
  joinRoomSchema,
  rejoinRoomSchema,
  videoChangeSchema,
  playbackEventSchema,
  seekEventSchema,
  syncRequestSchema,
  playerReadySchema,
  chatMessageSchema,
  adminGrantSchema,
  clientHeartbeatSchema,
  PlaybackStatus,
  RoomRole,
} from '../rooms/room.types.js';
import type {
  RoomPlaybackState,
  RoomUser,
  PublicRoomState,
  ChatMessage,
  WatchedVideo,
} from '../rooms/room.types.js';
import { generateRoomId, generateUserId, generateMessageId, hashPin, verifyPin } from '../utils/ids.js';
import { extractYoutubeVideoId, fetchVideoMeta } from '../utils/youtube.js';
import { now, computeCurrentRoomTime } from '../utils/time.js';
import { config } from '../config.js';
import { clearRoomTsMap } from './playback.handlers.js';

const repo = roomRepository();
const DISCONNECT_GRACE_SECONDS = 30;

// --- Helper: Build Public Room State ---

async function buildPublicRoomState(roomId: string): Promise<PublicRoomState | null> {
  const room = await repo.getRoom(roomId);
  if (!room) return null;
  const users = await repo.getUsers(roomId);
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    userCount: users.filter((u) => !(u as any).disconnectedAt).length,
    maxUsers: room.maxUsers,
    hasVideo: room.playback.videoId !== null,
    ownerUserId: room.ownerUserId,
    playback: room.playback,
  };
}

// Mevcut aktif videonun metasını getir (video yoksa null). Cache'li -> ucuz.
async function getCurrentVideoMeta(videoId: string | null) {
  if (!videoId) return null;
  return fetchVideoMeta(videoId);
}

// --- Helper: Broadcast room list update ---

function broadcastRoomList() {
  getIO().emit('room:list:update');
}

// --- Helper: Broadcast to all users in room ---

function broadcastToRoom(roomId: string, event: string, data: any) {
  getIO().to(roomId).emit(event, data);
}

// --- Helper: Transfer ownership ---

async function transferOwnership(roomId: string): Promise<void> {
  const room = await repo.getRoom(roomId);
  if (!room) return;

  const users = await repo.getUsers(roomId);
  const connected = users.filter((u) => !(u as any).disconnectedAt);
  if (connected.length === 0) return;

  const admin = connected.find((u) => u.role === RoomRole.Admin);
  const candidate = admin || connected[0];

  const updatedUsers = await repo.updateUserRole(roomId, candidate.id, RoomRole.Owner);
  if (!updatedUsers) return;

  room.ownerUserId = candidate.id;
  await repo.saveRoom(room);

  broadcastToRoom(roomId, 'room:users:update', updatedUsers);
  broadcastToRoom(roomId, 'system:message', {
    id: generateMessageId(),
    text: `${candidate.displayName} odanın yeni sahibi oldu.`,
    createdAt: now(),
  });
  broadcastRoomList();
}

// Track active disconnect timers so we can clear them on rejoin
const disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

async function scheduleDisconnectCleanup(userId: string, roomId: string) {
  const timerKey = `${roomId}:${userId}`;

  // Clear any existing timer for this user
  const existingTimer = disconnectTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    disconnectTimers.delete(timerKey);
  }

  // Set new timer
  const timer = setTimeout(async () => {
    disconnectTimers.delete(timerKey);

    // Check if user is still disconnected
    const users = await repo.getUsers(roomId);
    const user = users.find((u) => u.id === userId);
    if (user && (user as any).disconnectedAt) {
      // Still disconnected after grace period — remove them
      await repo.removeUser(roomId, userId);
      const remaining = await repo.getUsers(roomId);
      const connected = remaining.filter((u) => !(u as any).disconnectedAt);

      broadcastToRoom(roomId, 'room:users:update', remaining);
      broadcastToRoom(roomId, 'user:left', { userId });
      broadcastToRoom(roomId, 'system:message', {
        id: generateMessageId(),
        text: `${user.displayName} bağlantısı kesildi.`,
        createdAt: now(),
      });

      const room = await repo.getRoom(roomId);
      if (room && room.ownerUserId === userId && connected.length > 0) {
        await transferOwnership(roomId);
      }

      // If no connected users, delete room
      if (connected.length === 0) {
        await repo.deleteRoom(roomId);
        clearRoomTsMap(roomId);
      }

      broadcastRoomList();
    }
  }, DISCONNECT_GRACE_SECONDS * 1000);

  disconnectTimers.set(timerKey, timer);
}

export function registerRoomHandlers(socket: Socket) {
  // --- Room: Create ---
  socket.on('room:create', async (payload: unknown) => {
    const parsed = createRoomSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçersiz oda bilgileri.' });
      return;
    }

    const { roomName, pin, displayName, initialYoutubeUrl } = parsed.data;
    const roomId = generateRoomId();
    const userId = generateUserId();

    let videoId: string | null = null;
    if (initialYoutubeUrl) {
      videoId = extractYoutubeVideoId(initialYoutubeUrl);
    }

    const playbackState: RoomPlaybackState = {
      videoId,
      status: PlaybackStatus.Idle,
      baseTime: 0,
      baseServerTime: now(),
      version: 1,
      updatedBy: userId,
    };

    const roomRecord = {
      id: roomId,
      name: roomName,
      pinHash: hashPin(pin),
      createdAt: now(),
      updatedAt: now(),
      expiresAt: now() + config.roomActiveTtlSeconds * 1000,
      ownerUserId: userId,
      maxUsers: config.roomMaxUsers,
      playback: playbackState,
    };

    await repo.saveRoom(roomRecord);

    const user: RoomUser = {
      id: userId,
      socketId: socket.id,
      displayName,
      role: RoomRole.Owner,
      joinedAt: now(),
      lastSeenAt: now(),
    };

    await repo.addUser(roomId, user);
    await repo.storeSocketUserMap(socket.id, { userId, roomId });

    void socket.join(roomId);

    const publicRoom = await buildPublicRoomState(roomId);
    const users = await repo.getUsers(roomId);
    const shareUrl = `${config.publicBaseUrl}/room/${roomId}`;
    const meta = await getCurrentVideoMeta(videoId);

    // Oda oluşturulurken başlangıç videosunu watchlist'e ekle
    let watchlist: WatchedVideo[] = [];
    if (videoId) {
      watchlist = await repo.addWatchedVideo(roomId, {
        videoId,
        title: meta?.title ?? null,
        channel: meta?.channel ?? null,
        durationSeconds: meta?.durationSeconds ?? null,
        thumbnail: meta?.thumbnail ?? null,
        addedBy: { id: userId, displayName },
        addedAt: now(),
      });
    }

    socket.emit('room:created', {
      roomId,
      shareUrl,
      user,
      room: publicRoom,
      users,
    });

    socket.emit('room:joined', {
      room: publicRoom,
      user,
      users,
      chatHistory: [],
      watchlist,
      meta,
      serverTime: now(),
      syncTarget: {
        videoId,
        status: playbackState.status,
        targetTime: 0,
        version: playbackState.version,
      },
    });

    broadcastRoomList();
  });

  // --- Room: Join ---
  socket.on('room:join', async (payload: unknown) => {
    const parsed = joinRoomSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçersiz katılım bilgileri.' });
      return;
    }

    const { roomId, pin, displayName } = parsed.data;

    const pinAttempts = (socket.data.pinAttempts || 0) + 1;
    socket.data.pinAttempts = pinAttempts;
    if (pinAttempts > 5 && socket.data.pinLockedUntil && socket.data.pinLockedUntil > now()) {
      socket.emit('room:error', { message: 'Çok fazla deneme. 30 saniye bekleyin.' });
      return;
    }
    if (pinAttempts > 5) {
      socket.data.pinLockedUntil = now() + 30_000;
      socket.emit('room:error', { message: 'Çok fazla deneme. 30 saniye bekleyin.' });
      return;
    }

    const room = await repo.getRoom(roomId);
    if (!room) {
      socket.emit('room:error', { message: 'Bu oda bulunamadı veya süresi dolmuş.' });
      return;
    }

    if (!verifyPin(pin, room.pinHash)) {
      socket.emit('room:error', { message: 'PIN yanlış.' });
      return;
    }

    const users = await repo.getUsers(roomId);
    // Count all users including disconnected ones — reserved slots for 30s grace
    if (users.length >= room.maxUsers) {
      socket.emit('room:error', { message: 'Bu oda dolu.' });
      return;
    }

    // Check if this socket already has a user in the room (same socket reconnect)
    const existingForSocket = await repo.findUserBySocketId(roomId, socket.id);
    if (existingForSocket) {
      delete (existingForSocket as any).disconnectedAt;
      existingForSocket.socketId = socket.id;
      existingForSocket.lastSeenAt = now();
      await repo.saveUsers(roomId, users.map((u) => (u.id === existingForSocket.id ? existingForSocket : u)));
      await repo.storeSocketUserMap(socket.id, { userId: existingForSocket.id, roomId });
      void socket.join(roomId);

      // Cancel disconnect timer
      const timerKey = `${roomId}:${existingForSocket.id}`;
      const timer = disconnectTimers.get(timerKey);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(timerKey);
      }

      const publicRoom = await buildPublicRoomState(roomId);
      const chatHistory = await repo.getChatMessages(roomId);
      const watchlist = await repo.getWatchedVideos(roomId);
      const meta = await getCurrentVideoMeta(room.playback.videoId);
      const targetTime = computeCurrentRoomTime(room.playback);

      socket.emit('room:joined', {
        room: publicRoom,
        user: existingForSocket,
        users,
        chatHistory,
        watchlist,
        meta,
        serverTime: now(),
        syncTarget: {
          videoId: room.playback.videoId,
          status: room.playback.status,
          targetTime,
          version: room.playback.version,
        },
      });

      broadcastToRoom(roomId, 'room:users:update', users);
      return;
    }

    const userId = generateUserId();
    const user: RoomUser = {
      id: userId,
      socketId: socket.id,
      displayName,
      role: RoomRole.Member,
      joinedAt: now(),
      lastSeenAt: now(),
    };

    await repo.addUser(roomId, user);
    await repo.storeSocketUserMap(socket.id, { userId, roomId });
    void socket.join(roomId);

    socket.data.pinAttempts = 0;

    const updatedUsers = await repo.getUsers(roomId);
    const publicRoom = await buildPublicRoomState(roomId);
    const chatHistory = await repo.getChatMessages(roomId);
    const watchlist = await repo.getWatchedVideos(roomId);
    const meta = await getCurrentVideoMeta(room.playback.videoId);
    const targetTime = computeCurrentRoomTime(room.playback);

    socket.emit('room:joined', {
      room: publicRoom,
      user,
      users: updatedUsers,
      chatHistory,
      watchlist,
      meta,
      serverTime: now(),
      syncTarget: {
        videoId: room.playback.videoId,
        status: room.playback.status,
        targetTime,
        version: room.playback.version,
      },
    });

    broadcastToRoom(roomId, 'user:joined', { user });
    broadcastToRoom(roomId, 'room:users:update', updatedUsers);
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${displayName} odaya katıldı.`,
      createdAt: now(),
    });

    broadcastRoomList();
  });

  // --- Room: Leave (explicit - removes user immediately) ---
  socket.on('room:leave', async () => {
    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping) return;

    const { userId, roomId } = mapping;
    const user = await repo.getUser(roomId, userId);
    if (!user) return;

    // Cancel any disconnect timer
    const timerKey = `${roomId}:${userId}`;
    const timer = disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(timerKey);
    }

    await repo.removeUser(roomId, userId);
    await repo.deleteSocketUserMap(socket.id);
    void socket.leave(roomId);

    const users = await repo.getUsers(roomId);
    broadcastToRoom(roomId, 'room:users:update', users);
    broadcastToRoom(roomId, 'user:left', { userId: user.id });
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${user.displayName} odadan ayrıldı.`,
      createdAt: now(),
    });

    const room = await repo.getRoom(roomId);
    if (room && room.ownerUserId === userId) {
      await transferOwnership(roomId);
    }

    if (users.length === 0) {
      await repo.deleteRoom(roomId);
      clearRoomTsMap(roomId);
    }

    broadcastRoomList();
  });

  // --- Room: Rejoin (same browser, new tab/socket, or after refresh) ---
  socket.on('room:rejoin', async (payload: unknown) => {
    const parsed = rejoinRoomSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Geçersiz yeniden katılım bilgileri.' });
      return;
    }

    const { roomId, userId, displayName } = parsed.data;

    const room = await repo.getRoom(roomId);
    if (!room) {
      socket.emit('room:error', { message: 'Bu oda bulunamadı veya süresi dolmuş.' });
      return;
    }

    const users = await repo.getUsers(roomId);
    const existingUser = users.find((u) => u.id === userId);
    if (!existingUser) {
      socket.emit('room:error', { message: 'Oturumunuz geçersiz. Lütfen PIN ile tekrar katılın.' });
      return;
    }

    // Cancel disconnect timer if user was in grace period
    const timerKey = `${roomId}:${userId}`;
    const timer = disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(timerKey);
    }

    // Clear disconnect flag
    delete (existingUser as any).disconnectedAt;

    // Remove old socket mapping
    if (existingUser.socketId && existingUser.socketId !== socket.id) {
      await repo.deleteSocketUserMap(existingUser.socketId);
      const oldSocket = getIO().sockets.sockets.get(existingUser.socketId);
      if (oldSocket) {
        void oldSocket.leave(roomId);
      }
    }

    // Update user with new socket
    existingUser.socketId = socket.id;
    existingUser.displayName = displayName;
    existingUser.lastSeenAt = now();
    await repo.saveUsers(roomId, users.map((u) => (u.id === existingUser.id ? existingUser : u)));
    await repo.storeSocketUserMap(socket.id, { userId: existingUser.id, roomId });
    void socket.join(roomId);

    const publicRoom = await buildPublicRoomState(roomId);
    const chatHistory = await repo.getChatMessages(roomId);
    const watchlist = await repo.getWatchedVideos(roomId);
    const meta = await getCurrentVideoMeta(room.playback.videoId);
    const targetTime = computeCurrentRoomTime(room.playback);

    socket.emit('room:joined', {
      room: publicRoom,
      user: existingUser,
      users,
      chatHistory,
      watchlist,
      meta,
      serverTime: now(),
      syncTarget: {
        videoId: room.playback.videoId,
        status: room.playback.status,
        targetTime,
        version: room.playback.version,
      },
    });

    broadcastToRoom(roomId, 'room:users:update', users);
  });

  // --- Room: List ---
  socket.on('room:list', async () => {
    const rooms = await repo.getAllRooms();
    const publicRooms = (await Promise.all(
      rooms.map(async (room) => {
        const users = await repo.getUsers(room.id);
        const connectedCount = users.filter((u) => !(u as any).disconnectedAt).length;
        if (connectedCount === 0) return null;
        // Aktif videonun metası (cache'li). Oda kartında başlık/kanal gösterimi için.
        const meta = await getCurrentVideoMeta(room.playback.videoId);
        return {
          id: room.id,
          name: room.name,
          createdAt: room.createdAt,
          userCount: connectedCount,
          maxUsers: room.maxUsers,
          hasVideo: room.playback.videoId !== null,
          playback: {
            videoId: room.playback.videoId,
            status: room.playback.status,
            version: room.playback.version,
          },
          meta,
        };
      }),
    )).filter((r): r is NonNullable<typeof r> => r !== null);
    socket.emit('room:list', publicRooms);
  });

  // --- Disconnect: 30s grace period before removing user ---
  socket.on('disconnect', async () => {
    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping) return;

    const { userId, roomId } = mapping;
    const user = await repo.getUser(roomId, userId);
    if (!user) return;

    // Don't remove user — mark as disconnected and schedule cleanup
    await repo.deleteSocketUserMap(socket.id);
    void socket.leave(roomId);

    (user as any).disconnectedAt = now();
    const users = await repo.getUsers(roomId);
    await repo.saveUsers(roomId, users.map((u) => (u.id === user.id ? user : u)));

    // Broadcast updated user list (shows disconnected user)
    broadcastToRoom(roomId, 'room:users:update', users);

    // Schedule removal after grace period
    await scheduleDisconnectCleanup(userId, roomId);
  });
}
