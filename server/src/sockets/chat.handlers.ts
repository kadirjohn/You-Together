import type { Socket } from 'socket.io';
import { roomRepository } from '../rooms/room.repository.js';
import { chatMessageSchema } from '../rooms/room.types.js';
import type { ChatMessage } from '../rooms/room.types.js';
import { generateMessageId } from '../utils/ids.js';
import { now } from '../utils/time.js';
import { getIO } from './socket.server.js';

const repo = roomRepository();

export function registerChatHandlers(socket: Socket) {
  socket.on('chat:message', async (payload: unknown) => {
    const parsed = chatMessageSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('room:error', { message: 'Mesaj 1-500 karakter olmalı.' });
      return;
    }

    const { roomId, text } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user) return;

    // Rate limit: max 3 messages per second
    const chatKey = `chat:${socket.id}`;
    const nowTime = now();
    const timestamps: number[] = (socket.data as any)[chatKey] || [];
    timestamps.push(nowTime);
    const recentTs = timestamps.filter((t) => nowTime - t < 1000);
    (socket.data as any)[chatKey] = recentTs;
    if (recentTs.length > 3) return;

    // HTML escape
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const message: ChatMessage = {
      id: generateMessageId(),
      roomId,
      userId: user.id,
      displayName: user.displayName,
      role: user.role,
      text: escaped,
      createdAt: now(),
    };

    await repo.addChatMessage(roomId, message);

    getIO().to(roomId).emit('chat:message', message);
  });
}
