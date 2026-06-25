import { useState, useRef } from 'react';
import { getSocket } from '../lib/socket';
import { useRoomStore } from '../stores/room.store';
import { useUIStore } from '../stores/ui.store';

interface SubtitleModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SubtitleModal({ open, onClose }: SubtitleModalProps) {
  const room = useRoomStore((s) => s.room);
  const currentUser = useRoomStore((s) => s.currentUser);
  const { addToast } = useUIStore();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';
  if (!open || !room || !isAdmin) return null;

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.srt') && !file.name.endsWith('.vtt')) {
      addToast('Sadece .srt veya .vtt dosyaları yükleyebilirsin.', 'error');
      return;
    }
    setLoading(true);
    try {
      const text = await file.text();
      const blob = new Blob([text], { type: file.name.endsWith('.srt') ? 'text/plain' : 'text/vtt' });
      const objectUrl = URL.createObjectURL(blob);
      emit(objectUrl);
    } catch {
      addToast('Altyazı dosyası okunamadı.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const emit = (subtitleUrl: string | null) => {
    getSocket().emit('subtitle:set', { roomId: room.id, subtitleUrl });
    addToast(subtitleUrl ? 'Altyazı uygulandı.' : 'Altyazı kaldırıldı.', 'info');
    setUrl('');
    onClose();
  };

  const handleUrl = () => {
    if (!url.trim()) return;
    emit(url.trim());
  };

  const handleRemove = () => {
    emit(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-bg-panel border-[3px] border-white/10 rounded-3xl p-6 shadow-cartoon-card animate-pop-in">
        <h3 className="text-xl font-black text-text-main mb-4">Altyazı</h3>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="SRT/VTT URL'si (opsiyonel)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrl()}
            className="w-full px-3 py-2 bg-bg-card cartoon-input text-text-main placeholder-text-muted text-sm font-semibold rounded-xl"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-2 bg-bg-card text-text-main font-bold rounded-xl border-2 border-white/10 hover:border-red-main/50 text-sm"
            >
              Dosya seç
            </button>
            <button
              onClick={handleUrl}
              disabled={!url.trim() || loading}
              className="flex-1 py-2 bg-red-main text-white font-bold rounded-xl cartoon-btn-sm hover:bg-red-soft disabled:opacity-50 text-sm"
            >
              URL'den uygula
            </button>
          </div>
          <button
            onClick={handleRemove}
            className="w-full py-2 text-text-muted hover:text-red-main font-bold text-sm"
          >
            Altyazıyı kaldır
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 bg-bg-card text-text-main font-bold rounded-xl border-2 border-white/10 hover:border-white/30 text-sm"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
