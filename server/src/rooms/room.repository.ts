import { getRedis, RedisKeys } from '../redis/client.js';
import { config } from '../config.js';
import type { RoomRecord, RoomUser, ChatMessage, RoomPlaybackState } from './room.types.js';
import { now } from '../utils/time.js';

export function roomRepository() {
  const redis = getRedis();

  return {
    async saveRoom(room: RoomRecord): Promise<void> {
      const pipeline = redis.pipeline();
      pipeline.set(
        RedisKeys.room(room.id),
        JSON.stringify(room),
        'EX',
        config.roomActiveTtlSeconds,
      );
      // Also refresh TTL on associated keys
      pipeline.expire(RedisKeys.roomUsers(room.id), config.roomActiveTtlSeconds);
      pipeline.expire(RedisKeys.roomChat(room.id), config.roomActiveTtlSeconds);
      pipeline.expire(RedisKeys.roomPin(room.id), config.roomActiveTtlSeconds);
      await pipeline.exec();
    },

    async getRoom(roomId: string): Promise<RoomRecord | null> {
      const raw = await redis.get(RedisKeys.room(roomId));
      if (!raw) return null;
      try {
        const record = JSON.parse(raw) as RoomRecord;
        return record;
      } catch {
        return null;
      }
    },

    async deleteRoom(roomId: string): Promise<void> {
      await Promise.all([
        redis.del(RedisKeys.room(roomId)),
        redis.del(RedisKeys.roomUsers(roomId)),
        redis.del(RedisKeys.roomChat(roomId)),
        redis.del(RedisKeys.roomPin(roomId)),
      ]);
    },

    async setRoomTtl(roomId: string, ttlSeconds: number): Promise<void> {
      await redis.expire(RedisKeys.room(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomUsers(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomChat(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomPin(roomId), ttlSeconds);
    },

    async updatePlaybackState(
      roomId: string,
      playback: RoomPlaybackState,
    ): Promise<RoomRecord | null> {
      const room = await this.getRoom(roomId);
      if (!room) return null;
      room.playback = playback;
      room.updatedAt = now();
      await this.saveRoom(room);
      return room;
    },

    async getUsers(roomId: string): Promise<RoomUser[]> {
      const raw = await redis.get(RedisKeys.roomUsers(roomId));
      if (!raw) return [];
      try {
        return JSON.parse(raw) as RoomUser[];
      } catch {
        return [];
      }
    },

    async saveUsers(roomId: string, users: RoomUser[]): Promise<void> {
      await redis.set(
        RedisKeys.roomUsers(roomId),
        JSON.stringify(users),
        'EX',
        config.roomActiveTtlSeconds,
      );
    },

    async addUser(roomId: string, user: RoomUser): Promise<RoomUser[]> {
      const users = await this.getUsers(roomId);
      users.push(user);
      await this.saveUsers(roomId, users);
      return users;
    },

    async removeUser(roomId: string, userId: string): Promise<RoomUser[]> {
      const users = await this.getUsers(roomId);
      const filtered = users.filter((u) => u.id !== userId);
      await this.saveUsers(roomId, filtered);
      return filtered;
    },

    async getUser(roomId: string, userId: string): Promise<RoomUser | undefined> {
      const users = await this.getUsers(roomId);
      return users.find((u) => u.id === userId);
    },

    async findUserBySocketId(
      roomId: string,
      socketId: string,
    ): Promise<RoomUser | undefined> {
      const users = await this.getUsers(roomId);
      return users.find((u) => u.socketId === socketId);
    },

    async updateUserRole(
      roomId: string,
      userId: string,
      role: RoomUser['role'],
    ): Promise<RoomUser[] | null> {
      const users = await this.getUsers(roomId);
      const user = users.find((u) => u.id === userId);
      if (!user) return null;
      user.role = role;
      await this.saveUsers(roomId, users);
      return users;
    },

    async getChatMessages(roomId: string): Promise<ChatMessage[]> {
      const raw = await redis.get(RedisKeys.roomChat(roomId));
      if (!raw) return [];
      try {
        return JSON.parse(raw) as ChatMessage[];
      } catch {
        return [];
      }
    },

    async addChatMessage(roomId: string, message: ChatMessage): Promise<ChatMessage[]> {
      const messages = await this.getChatMessages(roomId);
      messages.push(message);
      // Keep only last N messages
      if (messages.length > config.chatMaxMessages) {
        messages.splice(0, messages.length - config.chatMaxMessages);
      }
      await redis.set(
        RedisKeys.roomChat(roomId),
        JSON.stringify(messages),
        'EX',
        config.roomActiveTtlSeconds,
      );
      return messages;
    },

    async getAllRooms(): Promise<RoomRecord[]> {
      const keys = await redis.keys('room:*');
      const roomKeys = keys.filter(
        (k) =>
          !k.includes(':users') && !k.includes(':chat') && !k.includes(':pin'),
      );

      if (roomKeys.length === 0) return [];

      const pipeline = redis.pipeline();
      roomKeys.forEach((key) => pipeline.get(key));
      const results = await pipeline.exec();

      const rooms: RoomRecord[] = [];
      if (results) {
        for (const [err, raw] of results) {
          if (err || !raw) continue;
          try {
            rooms.push(JSON.parse(raw as string) as RoomRecord);
          } catch {
            // skip malformed
          }
        }
      }
      return rooms;
    },

    async storeSocketUserMap(socketId: string, data: { userId: string; roomId: string }): Promise<void> {
      await redis.set(RedisKeys.socketUser(socketId), JSON.stringify(data));
    },

    async getSocketUserMap(socketId: string): Promise<{ userId: string; roomId: string } | null> {
      const raw = await redis.get(RedisKeys.socketUser(socketId));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { userId: string; roomId: string };
      } catch {
        return null;
      }
    },

    async deleteSocketUserMap(socketId: string): Promise<void> {
      await redis.del(RedisKeys.socketUser(socketId));
    },
  };
}
