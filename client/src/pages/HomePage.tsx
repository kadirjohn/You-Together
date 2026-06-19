import { useState, useEffect } from 'react';
import { getSocket } from '../lib/socket';
import type { PublicRoomSummary } from '../lib/socket';
import { useUIStore } from '../stores/ui.store';
import CreateRoomModal from '../components/CreateRoomModal';
import JoinRoomModal from '../components/JoinRoomModal';
import RoomCard from '../components/RoomCard';
export default function HomePage() {
  const [rooms, setRooms] = useState<PublicRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { showCreateModal, setShowCreateModal, openJoinModal } = useUIStore();

  const fetchRooms = () => {
    const socket = getSocket();
    socket.emit('room:list');
  };

  useEffect(() => {
    const socket = getSocket();

    const handleRoomList = (data: PublicRoomSummary[]) => {
      setRooms(data);
      setLoading(false);
    };

    const handleRoomListUpdate = () => {
      fetchRooms();
    };

    socket.on('room:list', handleRoomList);
    socket.on('room:list:update', handleRoomListUpdate);

    // Initial fetch
    if (socket.connected) {
      fetchRooms();
    } else {
      socket.once('connect', () => {
        fetchRooms();
      });
    }

    return () => {
      socket.off('room:list', handleRoomList);
      socket.off('room:list:update', handleRoomListUpdate);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg-main">
      {/* Header */}
      <header className="border-b border-white/5 bg-bg-panel/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-main/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-main" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-red-main">You</span>{' '}
              <span className="text-text-main">Together</span>
            </h1>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 bg-red-main text-white font-semibold rounded-xl
              glow-red-sm hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-95 text-sm"
          >
            Oda Oluştur
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-2xl mx-auto text-center px-4 py-16 animate-fade-in">
        <h2 className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight">
          <span className="text-red-main glow-red-sm inline-block px-2 rounded-lg">YouTube</span>{' '}
          videolarını arkadaşlarınla aynı anda izle.
        </h2>
        <p className="text-text-muted text-lg mb-8 leading-relaxed">
          Oda oluştur, linki paylaş, PIN ile katıl ve beraber izlemeye başla.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-red-main text-white font-semibold rounded-xl
              glow-red-sm hover:glow-red transition-all duration-300
              hover:bg-red-soft active:scale-95"
          >
            Oda Oluştur
          </button>
          <button
            onClick={fetchRooms}
            className="px-6 py-3 bg-bg-card text-text-main font-semibold rounded-xl
              border border-white/10 hover:border-red-main/30 transition-all duration-300
              hover:bg-bg-panel active:scale-95"
          >
            Odaları Yenile
          </button>
        </div>
      </section>

      {/* Room List */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-red-main border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center py-16 bg-bg-panel/30 rounded-2xl border border-white/5 animate-fade-in">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-text-muted text-lg">
              Beraber izleyebileceğin bir YouTube odası henüz bulunmuyor.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} onJoin={() => openJoinModal(room.id)} />
            ))}
          </div>
        )}
      </section>

      {/* Modals */}
      {showCreateModal && <CreateRoomModal />}
      <JoinRoomModal />
    </div>
  );
}
