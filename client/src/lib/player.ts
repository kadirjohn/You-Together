// Player soyutlaması — watchparty'den uyarlanmış, Faz 2'de mp4/hls desteği
// için. YouTube kısa vadede mevcut YouTubePlayer.tsx içinde kalıyor; ileride
// buraya taşınabilir.
export interface PlayerApi {
  getCurrentTime(): number;
  getDuration(): number;
  isMuted(): boolean;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  setSrcAndTime(src: string, time: number): void;
  playVideo(): void;
  pauseVideo(): void;
  seekVideo(time: number): void;
  shouldPlay(): boolean;
  setMute(muted: boolean): void;
  getVolume(): number;
  setVolume(volume: number): void;
  isReady(): boolean;
  clearState(): void;
  setLoop(loop: boolean): void;
  getVideoEl(): HTMLMediaElement | null;
  // Altyazı (mp4/hls için)
  loadSubtitles?(src: string | null): void;
  syncSubtitles?(sharerTime: number): void;
}

export type MediaType = 'youtube' | 'mp4' | 'hls' | null;

export function detectMediaType(input: string): MediaType {
  const url = input.trim().toLowerCase();
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('.m3u8')) return 'hls';
  if (url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.ogg')) return 'mp4';
  // HLS bazen parametreli URL olabilir
  if (url.includes('m3u8')) return 'hls';
  // MP4 de query string ile gelebilir
  if (url.includes('.mp4') || url.includes('.webm') || url.includes('.ogg')) return 'mp4';
  return null;
}
