import Redis from 'ioredis';
import { config } from '../config.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return redis;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status !== 'ready' && client.status !== 'connecting') {
    await client.connect();
  }
  return client;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// --- Redis Key Helpers ---

export const RedisKeys = {
  room: (roomId: string) => `room:${roomId}`,
  roomUsers: (roomId: string) => `room:${roomId}:users`,
  roomChat: (roomId: string) => `room:${roomId}:chat`,
  roomPin: (roomId: string) => `room:${roomId}:pin`,
  socketUser: (socketId: string) => `socket:${socketId}`,
  roomVideos: (roomId: string) => `room:${roomId}:videos`,
  youtubeVideo: (videoId: string) => `youtube:video:${videoId}`,
} as const;
