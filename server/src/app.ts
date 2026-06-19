import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { config } from './config.js';
import { connectRedis } from './redis/client.js';
import { createSocketServer, getIO } from './sockets/socket.server.js';
import { registerRoomHandlers } from './sockets/room.handlers.js';
import { registerPlaybackHandlers } from './sockets/playback.handlers.js';
import { registerChatHandlers } from './sockets/chat.handlers.js';
import { registerAdminHandlers } from './sockets/admin.handlers.js';
import { healthRoute, roomsRoute } from './http/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function createApp() {
  const app = Fastify({ logger: true });

  // CORS
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  // Serve client build in production
  const clientDistPath = join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
    });

    // SPA fallback
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/socket.io/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // HTTP Routes
  await healthRoute(app);
  await roomsRoute(app);

  // Create HTTP server
  const httpServer = createServer(app.server);

  // Create Socket.IO server
  const io = createSocketServer(httpServer);

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // Initialize rate limit data
    socket.data.pinAttempts = 0;
    socket.data.pinLockedUntil = 0;

    registerRoomHandlers(socket);
    registerPlaybackHandlers(socket);
    registerChatHandlers(socket);
    registerAdminHandlers(socket);
  });

  return { app, httpServer, io };
}

export async function startServer() {
  await connectRedis();
  const { httpServer } = await createApp();

  httpServer.listen({ port: config.port, host: '0.0.0.0' }, () => {
    console.log(`[Server] Running on http://0.0.0.0:${config.port}`);
    console.log(`[Server] Env: ${config.nodeEnv}`);
  });
}
