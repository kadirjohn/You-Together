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

export interface RoomUser {
  id: string;
  socketId: string;
  displayName: string;
  role: RoomRole;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomPlaybackState {
  videoId: string | null;
  status: PlaybackStatus;
  baseTime: number;
  baseServerTime: number;
  version: number;
  updatedBy: string | null;
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

export const chatMessageSchema = z.object({
  roomId: z.string().min(1),
  text: z.string().min(1).max(500).trim(),
});

export const adminGrantSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export const clientHeartbeatSchema = z.object({
  roomId: z.string().min(1),
});
