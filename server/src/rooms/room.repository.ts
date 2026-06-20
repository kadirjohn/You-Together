import { getRedis, RedisKeys } from '../redis/client.js';
import { config } from '../config.js';
import type { RoomRecord, RoomUser, ChatMessage, RoomPlaybackState, WatchedVideo } from './room.types.js';
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
      pipeline.expire(RedisKeys.roomVideos(room.id), config.roomActiveTtlSeconds);
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
        redis.del(RedisKeys.roomVideos(roomId)),
      ]);
    },

    async setRoomTtl(roomId: string, ttlSeconds: number): Promise<void> {
      await redis.expire(RedisKeys.room(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomUsers(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomChat(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomPin(roomId), ttlSeconds);
      await redis.expire(RedisKeys.roomVideos(roomId), ttlSeconds);
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

    // --- Watch list (partide izlenen videolar) ---

    async getWatchedVideos(roomId: string): Promise<WatchedVideo[]> {
      const raw = await redis.get(RedisKeys.roomVideos(roomId));
      if (!raw) return [];
      try {
        return JSON.parse(raw) as WatchedVideo[];
      } catch {
        return [];
      }
    },

    // Videoyu izlenenler listesine ekle. Aynı videoId zaten varsa en üste taşı
    // (addedAt/addedBy güncelle) — "en son izlenenler üstte" sıralaması + duplikasyon önler.
    async addWatchedVideo(roomId: string, video: WatchedVideo): Promise<WatchedVideo[]> {
      const videos = await this.getWatchedVideos(roomId);
      const existingIdx = videos.findIndex((v) => v.videoId === video.videoId);
      if (existingIdx >= 0) {
        // En üste taşımak için önce çıkarıp sona ekle (listenin sonu = en yeni)
        videos.splice(existingIdx, 1);
      }
      videos.push(video);
      // Üst sınırı aşarsa en eskileri (baştan) kaydır
      if (videos.length > config.watchlistMaxVideos) {
        videos.splice(0, videos.length - config.watchlistMaxVideos);
      }
      await redis.set(
        RedisKeys.roomVideos(roomId),
        JSON.stringify(videos),
        'EX',
        config.roomActiveTtlSeconds,
      );
      return videos;
    },

    async clearWatchedVideos(roomId: string): Promise<void> {
      await redis.del(RedisKeys.roomVideos(roomId));
    },

    async getAllRooms(): Promise<RoomRecord[]> {
      // SCAN (imleç tabanlı) — production Redis'inde KES'in O(N) bloklama
      // operasyonundan kaçınır. Küçük ölçekte fark etmez ama ölçeklenirken güvenli.
      const roomKeys: string[] = [];
      let cursor = '0';
      do {
        // ioredis SCAN döne: [nextCursor, keys[]]
        const [nextCursor, batch] = await redis.scan(
          cursor,
          'MATCH',
          'room:*',
          'COUNT',
          200,
        );
        cursor = nextCursor;
        for (const key of batch) {
          // users / chat / pin / videos sub-key'lerini ele
          if (
            !key.includes(':users') &&
            !key.includes(':chat') &&
            !key.includes(':pin') &&
            !key.includes(':videos')
          ) {
            roomKeys.push(key);
          }
        }
      } while (cursor !== '0');

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
