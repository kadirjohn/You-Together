import { z } from 'zod';
import { config } from '../config.js';

// --- Shared Types ---

export const RoomRole = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
} as const;
export type RoomRole = (typeof RoomRole)[keyof typeof RoomRole];

export const PlaybackStatus = {
  Idle: 'idle',
  Playing: 'playing',
  Paused: 'paused',
  Buffering: 'buffering',
} as const;
export type PlaybackStatus = (typeof PlaybackStatus)[keyof typeof PlaybackStatus];

export const MediaType = {
  YouTube: 'youtube',
  Mp4: 'mp4',
  Hls: 'hls',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export interface RoomUser {
  id: string;
  socketId: string;
  displayName: string;
  role: RoomRole;
  joinedAt: number;
  lastSeenAt: number;
  disconnectedAt?: number;
}

export interface RoomPlaybackState {
  videoId: string | null; // YouTube videosu için
  mediaType: MediaType | null; // 'youtube' | 'mp4' | 'hls'
  mediaUrl: string | null; // mp4/hls için doğrudan URL
  status: PlaybackStatus;
  baseTime: number;
  baseServerTime: number;
  version: number;
  updatedBy: string | null;
  playbackRate: number; // 0 = auto sync, >0 = fixed shared rate
  loop: boolean;
  subtitle: string | null; // altyazı VTT/SRT URL (mp4/hls için)
}

// YouTube video metadata. Sunucu-taraflı fetch edilir, Redis'te cache'lenir.
// durationSeconds yalnızca YouTube Data API ile gelir; yoksa null (istemci fallback).
export interface VideoMeta {
  videoId: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  fetchedAt: number;
}

// Oda bazlı izlenen-videolar listesi elemanı (watch list). Ephemeral, oda TTL'i ile sınırlı.
export interface WatchedVideo {
  videoId: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  addedBy: { id: string; displayName: string };
  addedAt: number;
}

export interface PlaylistItem {
  id: string;
  // YouTube veya generic medya URL
  url: string;
  mediaType: MediaType | null;
  title: string | null;
  addedBy: { id: string; displayName: string };
  addedAt: number;
}

export interface RoomRecord {
  id: string;
  name: string;
  pinHash: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  ownerUserId: string;
  maxUsers: number;
  playback: RoomPlaybackState;
}

export interface PublicRoomState {
  id: string;
  name: string;
  createdAt: number;
  userCount: number;
  maxUsers: number;
  hasVideo: boolean;
  ownerUserId: string;
  playback: RoomPlaybackState;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: RoomRole;
  text: string;
  createdAt: number;
}

// --- Validation Schemas ---

export const createRoomSchema = z.object({
  roomName: z.string().min(3).max(60).trim(),
  pin: z.string().min(config.pinMinLength).max(config.pinMaxLength),
  displayName: z.string().min(2).max(24).trim(),
  initialYoutubeUrl: z.string().url().optional(),
});

export const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  pin: z.string().min(1),
  displayName: z.string().min(2).max(24).trim(),
});

export const videoChangeSchema = z.object({
  roomId: z.string().min(1),
  youtubeUrl: z.string().url(),
});

// Genel medya ayarlama (mp4 / hls). Admin/owner tarafından gönderilir.
export const mediaSetSchema = z.object({
  roomId: z.string().min(1),
  mediaType: z.enum(['mp4', 'hls']),
  mediaUrl: z.string().url().min(1),
});

export const playbackEventSchema = z.object({
  roomId: z.string().min(1),
  currentTime: z.number().min(0),
  clientEventId: z.string().min(1),
});

export const seekEventSchema = z.object({
  roomId: z.string().min(1),
  targetTime: z.number().min(0),
  shouldPlay: z.boolean(),
  clientEventId: z.string().min(1),
});

export const syncRequestSchema = z.object({
  roomId: z.string().min(1),
  localTime: z.number(),
  playerState: z.string(),
});

export const playerReadySchema = z.object({
  roomId: z.string().min(1),
});

// Client her saniye player'ın GERÇEK getCurrentTime() değerini gönderir.
// Sunucu bunu per-odaa in-memory tsMap'e normalize ederek yazar ve
// playback:tsmap olarak herkese broadcast eder (watchparty REC:tsMap modeli).
// Bu, baseTime/baseServerTime ekstrapolasyonuna ek bir "gerçek konum" katmanı:
// drift düzeltme artık iki serbest-sayan saati değil, gerçek video konumlarını
// karşılaştırır.
export const heartbeatSchema = z.object({
  roomId: z.string().min(1),
  currentTime: z.number(),
  clientEventId: z.string().optional(),
});

export const playbackRateSchema = z.object({
  roomId: z.string().min(1),
  rate: z.number().min(0).max(4),
  clientEventId: z.string().min(1),
});

export const loopSchema = z.object({
  roomId: z.string().min(1),
  loop: z.boolean(),
  clientEventId: z.string().min(1),
});

export const subtitleSchema = z.object({
  roomId: z.string().min(1),
  subtitleUrl: z.string().url().nullable(),
});

export const chatMessageSchema = z.object({
  roomId: z.string().min(1),
  text: z.string().min(1).max(500).trim(),
});

export const playlistAddSchema = z.object({
  roomId: z.string().min(1),
  url: z.string().url().min(1),
  title: z.string().optional(),
});

export const playlistRemoveSchema = z.object({
  roomId: z.string().min(1),
  itemId: z.string().min(1),
});

export const playlistMoveSchema = z.object({
  roomId: z.string().min(1),
  itemId: z.string().min(1),
  newIndex: z.number().int().min(0),
});

export const adminGrantSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export const rejoinRoomSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(2).max(24).trim(),
});

export const clientHeartbeatSchema = z.object({
  roomId: z.string().min(1),
});
