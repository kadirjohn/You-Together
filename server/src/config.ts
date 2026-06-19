import dotenv from 'dotenv';
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  roomMaxUsers: parseInt(process.env.ROOM_MAX_USERS || '10', 10),
  roomActiveTtlSeconds: parseInt(process.env.ROOM_ACTIVE_TTL_SECONDS || '10800', 10),
  roomEmptyTtlSeconds: parseInt(process.env.ROOM_EMPTY_TTL_SECONDS || '300', 10),
  chatMaxMessages: parseInt(process.env.CHAT_MAX_MESSAGES || '100', 10),
  pinMinLength: parseInt(process.env.PIN_MIN_LENGTH || '4', 10),
  pinMaxLength: parseInt(process.env.PIN_MAX_LENGTH || '12', 10),
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
} as const;

export type Config = typeof config;
