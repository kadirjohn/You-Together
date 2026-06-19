import type { Socket } from 'socket.io';
import { getIO } from './socket.server.js';
import { roomRepository } from '../rooms/room.repository.js';
import {
  createRoomSchema,
  joinRoomSchema,
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
} from '../rooms/room.types.js';
import { generateRoomId, generateUserId, generateMessageId, hashPin, verifyPin } from '../utils/ids.js';
import { extractYoutubeVideoId } from '../utils/youtube.js';
import { now, computeCurrentRoomTime } from '../utils/time.js';
import { config } from '../config.js';

const repo = roomRepository();

// --- Helper: Build Public Room State ---

async function buildPublicRoomState(roomId: string): Promise<PublicRoomState | null> {
  const room = await repo.getRoom(roomId);
  if (!room) return null;
  const users = await repo.getUsers(roomId);
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    userCount: users.length,
    maxUsers: room.maxUsers,
    hasVideo: room.playback.videoId !== null,
    ownerUserId: room.ownerUserId,
    playback: room.playback,
  };
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
  if (users.length === 0) return;

  // Prefer admin, then oldest member
  const admin = users.find((u) => u.role === RoomRole.Admin);
  const candidate = admin || users[0];

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

    socket.emit('room:created', {
      roomId,
      shareUrl,
      user,
      room: publicRoom,
      users,
    });

    // Also join success for the creator
    socket.emit('room:joined', {
      room: publicRoom,
      user,
      users,
      chatHistory: [],
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

    // Rate limit PIN attempts
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
    if (users.length >= room.maxUsers) {
      socket.emit('room:error', { message: 'Bu oda dolu.' });
      return;
    }

    // Check if this socket already has a user in the room
    const existingForSocket = await repo.findUserBySocketId(roomId, socket.id);
    if (existingForSocket) {
      // Reconnection - update socket ID
      existingForSocket.socketId = socket.id;
      existingForSocket.lastSeenAt = now();
      await repo.saveUsers(roomId, users.map((u) => (u.id === existingForSocket.id ? existingForSocket : u)));
      await repo.storeSocketUserMap(socket.id, { userId: existingForSocket.id, roomId });
      void socket.join(roomId);

      const publicRoom = await buildPublicRoomState(roomId);
      const chatHistory = await repo.getChatMessages(roomId);
      const targetTime = computeCurrentRoomTime(room.playback);

      socket.emit('room:joined', {
        room: publicRoom,
        user: existingForSocket,
        users,
        chatHistory,
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

    // Reset PIN attempts on success
    socket.data.pinAttempts = 0;

    const updatedUsers = await repo.getUsers(roomId);
    const publicRoom = await buildPublicRoomState(roomId);
    const chatHistory = await repo.getChatMessages(roomId);
    const targetTime = computeCurrentRoomTime(room.playback);

    socket.emit('room:joined', {
      room: publicRoom,
      user,
      users: updatedUsers,
      chatHistory,
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

  // --- Room: Leave ---
  socket.on('room:leave', async () => {
    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping) return;

    const { userId, roomId } = mapping;
    const user = await repo.getUser(roomId, userId);
    if (!user) return;

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

    // Check ownership transfer
    const room = await repo.getRoom(roomId);
    if (room && room.ownerUserId === userId) {
      await transferOwnership(roomId);
    }

    // If room empty, set short TTL
    if (users.length === 0) {
      await repo.setRoomTtl(roomId, config.roomEmptyTtlSeconds);
    }

    broadcastRoomList();
  });

  // --- Room: List ---
  socket.on('room:list', async () => {
    const rooms = await repo.getAllRooms();
    const publicRooms = await Promise.all(
      rooms.map(async (room) => {
        const users = await repo.getUsers(room.id);
        return {
          id: room.id,
          name: room.name,
          createdAt: room.createdAt,
          userCount: users.length,
          maxUsers: room.maxUsers,
          hasVideo: room.playback.videoId !== null,
          playback: {
            videoId: room.playback.videoId,
            status: room.playback.status,
            version: room.playback.version,
          },
        };
      }),
    );
    socket.emit('room:list', publicRooms);
  });

  // Disconnect handler
  socket.on('disconnect', async () => {
    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping) return;

    const { userId, roomId } = mapping;
    const user = await repo.getUser(roomId, userId);
    if (!user) return;

    await repo.removeUser(roomId, userId);
    await repo.deleteSocketUserMap(socket.id);
    void socket.leave(roomId);

    const users = await repo.getUsers(roomId);
    broadcastToRoom(roomId, 'room:users:update', users);
    broadcastToRoom(roomId, 'user:left', { userId: user.id });
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${user.displayName} bağlantısı kesildi.`,
      createdAt: now(),
    });

    const room = await repo.getRoom(roomId);
    if (room && room.ownerUserId === userId) {
      await transferOwnership(roomId);
    }

    if (users.length === 0) {
      await repo.setRoomTtl(roomId, config.roomEmptyTtlSeconds);
    }

    broadcastRoomList();
  });
}
