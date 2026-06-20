import { getRedis, RedisKeys } from '../redis/client.js';
import { config } from '../config.js';
import type { VideoMeta } from '../rooms/room.types.js';

export function extractYoutubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function isValidYoutubeUrl(url: string): boolean {
  return extractYoutubeVideoId(url) !== null;
}

const THUMBNAIL_BASE = 'https://img.youtube.com/vi';

function thumbnail(videoId: string): string {
  return `${THUMBNAIL_BASE}/${videoId}/mqdefault.jpg`;
}

// ISO 8601 süre (PT1H2M3S) -> saniye. Data API contentDetails.duration bu formatta döner.
export function parseIsoDuration(iso: string): number | null {
  if (!iso || !iso.startsWith('PT')) return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// oEmbed: API key gerektirmez, title + channel + thumbnail verir, süre vermez.
async function fetchOEmbed(videoId: string): Promise<Partial<VideoMeta>> {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: data.title ?? null,
      channel: data.author_name ?? null,
      thumbnail: thumbnail(videoId),
    };
  } catch {
    return {};
  }
}

// YouTube Data API v3: süre + title + channel + thumbnail. API key gerektirir.
async function fetchViaDataApi(videoId: string): Promise<Partial<VideoMeta>> {
  if (!config.youtubeApiKey) return {};
  const url =
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails` +
    `&id=${videoId}&key=${config.youtubeApiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      items?: Array<{
        snippet?: { title?: string; channelTitle?: string };
        contentDetails?: { duration?: string };
      }>;
    };
    const item = data.items?.[0];
    if (!item) return {}; // video bulunamadı / özel / silinmiş
    return {
      title: item.snippet?.title ?? null,
      channel: item.snippet?.channelTitle ?? null,
      durationSeconds: parseIsoDuration(item.contentDetails?.duration || '') ?? null,
      thumbnail: thumbnail(videoId),
    };
  } catch {
    return {};
  }
}

// Bir video için metadata getir. Önce Redis cache, sonra Data API (key varsa), sonra oEmbed.
// Fetch başarısız olsa bile oynatma bloke olmaz: null alanlarla (ama videoId dolu) döner.
export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const redis = getRedis();
  const cacheKey = RedisKeys.youtubeVideo(videoId);

  // 1) Cache kontrolü
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as VideoMeta;
    }
  } catch {
    // cache okuma hatası -> fetch'e düş
  }

  // 2) Data API (key varsa) — süre dahil en zengin kaynak
  let partial: Partial<VideoMeta> = {};
  if (config.youtubeApiKey) {
    partial = await fetchViaDataApi(videoId);
  }
  // 3) oEmbed fallback — title/kanal için (süre vermez)
  if (!partial.title && !partial.channel) {
    const oembed = await fetchOEmbed(videoId);
    partial = { ...oembed, ...partial }; // Data API sonucu (varsa) öncelikli
  }

  const meta: VideoMeta = {
    videoId,
    title: partial.title ?? null,
    channel: partial.channel ?? null,
    durationSeconds: partial.durationSeconds ?? null,
    thumbnail: partial.thumbnail ?? thumbnail(videoId),
    fetchedAt: Date.now(),
  };

  // 4) Cache'le (fetch tamamen boş dahi olsa, tekrar tekrar denememek için kısa süreyle)
  const ttl = meta.title ? config.youtubeCacheTtlSeconds : 300; // boş sonuç: 5 dk
  try {
    await redis.set(cacheKey, JSON.stringify(meta), 'EX', ttl);
  } catch {
    // cache yazma hatası -> sonuç yine de döner
  }

  return meta;
}
