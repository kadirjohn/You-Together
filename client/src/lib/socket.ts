import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// --- Event Types ---

// YouTube video metadata (sunucu-taraflı fetch, Redis cache'li).
// durationSeconds yalnızca Data API ile gelir; yoksa null (istemci fallback).
export interface VideoMeta {
  videoId: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  fetchedAt: number;
}

// Oda bazlı izlenen-videolar listesi elemanı (watch list).
export interface WatchedVideo {
  videoId: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  addedBy: { id: string; displayName: string };
  addedAt: number;
}

export interface PublicRoomSummary {
  id: string;
  name: string;
  createdAt: number;
  userCount: number;
  maxUsers: number;
  hasVideo: boolean;
  playback: {
    videoId: string | null;
    status: string;
    version: number;
  };
  meta?: VideoMeta | null;
}

export interface RoomUser {
  id: string;
  socketId: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  lastSeenAt: number;
}

export interface PublicRoomState {
  id: string;
  name: string;
  createdAt: number;
  userCount: number;
  maxUsers: number;
  hasVideo: boolean;
  ownerUserId: string;
  playback: {
    videoId: string | null;
    status: string;
    baseTime: number;
    baseServerTime: number;
    version: number;
    updatedBy: string | null;
  };
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: string;
  text: string;
  createdAt: number;
}

export interface SyncTarget {
  videoId: string | null;
  status: string;
  targetTime: number;
  version: number;
}
