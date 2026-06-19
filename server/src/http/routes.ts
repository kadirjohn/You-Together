import type { FastifyInstance } from 'fastify';
import { roomRepository } from '../rooms/room.repository.js';
import { config } from '../config.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    const repo = roomRepository();
    let redisOk = false;
    try {
      const redis = app as any;
      redisOk = true;
    } catch {
      // ignore
    }
    return reply.send({
      status: 'ok',
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
    });
  });
}
