import type { Socket } from 'socket.io';
import { roomRepository } from '../rooms/room.repository.js';
import {
  playlistAddSchema,
  playlistRemoveSchema,
  playlistMoveSchema,
  RoomRole,
  MediaType,
  PlaybackStatus,
} from '../rooms/room.types.js';
import type { RoomPlaybackState } from '../rooms/room.types.js';
import { generateMessageId, generateUserId } from '../utils/ids.js';
import { now } from '../utils/time.js';
import { getIO } from './socket.server.js';
import { extractYoutubeVideoId } from '../utils/youtube.js';

const repo = roomRepository();

function broadcastToRoom(roomId: string, event: string, data: any) {
  getIO().to(roomId).emit(event, data);
}

function detectMediaType(url: string): MediaType | null {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return MediaType.YouTube;
  if (lower.includes('.m3u8') || lower.includes('m3u8')) return MediaType.Hls;
  if (lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.ogg')) return MediaType.Mp4;
  return null;
}

export function registerPlaylistHandlers(socket: Socket) {
  // --- Playlist: Add ---
  socket.on('playlist:add', async (payload: unknown) => {
    const parsed = playlistAddSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, url, title } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user) return;

    if (user.role !== RoomRole.Owner && user.role !== RoomRole.Admin) {
      socket.emit('room:error', { message: 'Sadece admin playliste ekleyebilir.' });
      return;
    }

    const mediaType = detectMediaType(url);
    if (!mediaType) {
      socket.emit('room:error', { message: 'Geçerli bir YouTube, mp4 veya m3u8 linki gir.' });
      return;
    }

    const item = {
      id: generateUserId(), // ID jeneratörü yeterli
      url,
      mediaType,
      title: title || null,
      addedBy: { id: user.id, displayName: user.displayName },
      addedAt: now(),
    };

    const playlist = await repo.addPlaylistItem(roomId, item);
    broadcastToRoom(roomId, 'playlist:update', playlist);
  });

  // --- Playlist: Remove ---
  socket.on('playlist:remove', async (payload: unknown) => {
    const parsed = playlistRemoveSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, itemId } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user || (user.role !== RoomRole.Owner && user.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin listeden çıkarabilir.' });
      return;
    }

    const playlist = await repo.removePlaylistItem(roomId, itemId);
    if (playlist) broadcastToRoom(roomId, 'playlist:update', playlist);
  });

  // --- Playlist: Move ---
  socket.on('playlist:move', async (payload: unknown) => {
    const parsed = playlistMoveSchema.safeParse(payload);
    if (!parsed.success) return;

    const { roomId, itemId, newIndex } = parsed.data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user || (user.role !== RoomRole.Owner && user.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin sıralama değiştirebilir.' });
      return;
    }

    const playlist = await repo.movePlaylistItem(roomId, itemId, newIndex);
    if (playlist) broadcastToRoom(roomId, 'playlist:update', playlist);
  });

  // --- Playlist: Next (video bittiğinde veya admin ileri bastığında) ---
  socket.on('playlist:next', async (payload: unknown) => {
    const data = payload as { roomId?: string };
    if (!data.roomId) return;
    const { roomId } = data;

    const mapping = await repo.getSocketUserMap(socket.id);
    if (!mapping || mapping.roomId !== roomId) return;

    const user = await repo.getUser(roomId, mapping.userId);
    if (!user || (user.role !== RoomRole.Owner && user.role !== RoomRole.Admin)) {
      socket.emit('room:error', { message: 'Sadece admin listede ilerleyebilir.' });
      return;
    }

    const playlist = await repo.getPlaylist(roomId);
    if (playlist.length === 0) {
      // Liste boşsa mevcut videoyu duraklat / beklet
      const room = await repo.getRoom(roomId);
      if (!room) return;
      const playback: RoomPlaybackState = {
        ...room.playback,
        status: PlaybackStatus.Paused,
        baseTime: 0,
        baseServerTime: now(),
        version: room.playback.version + 1,
        updatedBy: user.id,
      };
      await repo.updatePlaybackState(roomId, playback);
      broadcastToRoom(roomId, 'playback:state', {
        status: playback.status,
        baseTime: playback.baseTime,
        baseServerTime: playback.baseServerTime,
        version: playback.version,
        updatedBy: mapping.userId,
        serverTime: now(),
      });
      return;
    }

    // İlk sıradakini al, başa ekleme yerine kuyruktan çıkar (ilerleyerek)
    const [next] = playlist;
    const newPlaylist = playlist.slice(1);
    await repo.savePlaylist(roomId, newPlaylist);

    const room = await repo.getRoom(roomId);
    if (!room) return;

    const isYouTube = next.mediaType === MediaType.YouTube;
    const playback: RoomPlaybackState = {
      ...room.playback,
      videoId: isYouTube ? extractYoutubeVideoId(next.url) : null,
      mediaType: next.mediaType,
      mediaUrl: isYouTube ? null : next.url,
      status: PlaybackStatus.Playing,
      baseTime: 0,
      baseServerTime: now(),
      version: room.playback.version + 1,
      updatedBy: user.id,
      playbackRate: 0,
      loop: false,
      subtitle: null,
    };
    await repo.updatePlaybackState(roomId, playback);

    if (isYouTube) {
      broadcastToRoom(roomId, 'video:changed', {
        videoId: playback.videoId,
        state: playback,
        meta: null,
      });
    } else {
      broadcastToRoom(roomId, 'media:changed', {
        mediaType: next.mediaType === MediaType.Mp4 ? 'mp4' : 'hls',
        mediaUrl: next.url,
        state: playback,
      });
    }

    broadcastToRoom(roomId, 'playlist:update', newPlaylist);
    broadcastToRoom(roomId, 'system:message', {
      id: generateMessageId(),
      text: `${user.displayName} listedeki sonraki videoyu başlattı.`,
      createdAt: now(),
    });
  });
}
