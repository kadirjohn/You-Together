import type { FastifyInstance } from 'fastify';
import { roomRepository } from '../rooms/room.repository.js';
import { config } from '../config.js';
import { checkRedisHealth } from '../redis/client.js';
import { fetchVideoMeta } from '../utils/youtube.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    // Gerçek Redis ulaşılabilirlik kontrolü (öncesi taklit ediyordu, hiçbir şey ölçmüyordu).
    const redisOk = await checkRedisHealth();
    return reply.send({
      status: redisOk ? 'ok' : 'degraded',
      redis: redisOk,
      timestamp: Date.now(),
    });
  });
}

export async function roomsRoute(app: FastifyInstance) {
  const repo = roomRepository();

  app.get('/api/rooms', async (_req, reply) => {
    const rooms = await repo.getAllRooms();

    const publicRooms = (
      await Promise.all(
        rooms.map(async (room) => {
          const users = await repo.getUsers(room.id);
          if (users.length === 0) return null;
          const meta = room.playback.videoId ? await fetchVideoMeta(room.playback.videoId) : null;
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
            meta,
          };
        }),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    return reply.send(publicRooms);
  });

  app.get('/api/rooms/:roomId/public', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const room = await repo.getRoom(roomId);

    if (!room) {
      return reply.status(404).send({ error: 'Oda bulunamadı.' });
    }

    const users = await repo.getUsers(roomId);
    const meta = room.playback.videoId ? await fetchVideoMeta(room.playback.videoId) : null;
    return reply.send({
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
      meta,
    });
  });
}
