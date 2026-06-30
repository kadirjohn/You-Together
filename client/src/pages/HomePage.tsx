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
      <header className="border-b-[3px] border-white/5 bg-bg-panel/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/ytogether_logo.png"
              alt="You Together"
              className="w-10 h-10 rounded-xl object-contain drop-shadow-lg"
            />
            <h1 className="text-xl font-extrabold tracking-tight">
              <span className="text-red-main">You</span>{' '}
              <span className="text-text-main">Together</span>
            </h1>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 bg-red-main text-white font-extrabold rounded-2xl
              cartoon-btn-sm hover:bg-red-soft text-sm"
          >
            + Oda Kur
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-2xl mx-auto text-center px-4 py-16 animate-bounce-in relative">
        <div className="mb-6">
          <img
            src="/ytogether_logo.png"
            alt="You Together Logo"
            className="w-20 h-20 mx-auto rounded-2xl object-contain animate-float drop-shadow-[0_0_24px_rgba(255,0,51,0.3)]"
          />
        </div>

        <h2 className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight leading-tight">
          Arkadaşlarınla aynı anda{' '}
          <span className="text-red-main glow-red-sm inline-block px-2 rounded-xl">YouTube</span>
          <span className="text-white glow-white-sm inline-block px-1 rounded-xl">'dan</span>{' '}
          video izle
        </h2>
        <p className="text-text-muted text-lg mb-8 leading-relaxed font-semibold">
          Oda kur, linki at, hep birlikte izleyin
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-7 py-3.5 bg-red-main text-white font-extrabold rounded-2xl
              cartoon-btn hover:bg-red-soft text-base flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            Oda Kur
          </button>
          <button
            onClick={fetchRooms}
            className="px-7 py-3.5 bg-bg-card text-text-main font-extrabold rounded-2xl
              cartoon-btn hover:bg-bg-panel text-base flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Yenile
          </button>
        </div>
      </section>

      {/* Room List */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 border-[3px] border-red-main border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center py-16 bg-bg-panel/30 rounded-3xl border-[3px] border-white/5 animate-bounce-in">
            <div className="flex justify-center mb-4 animate-float">
              <svg className="w-16 h-16 text-red-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" />
                <path d="M7 2v20" />
                <path d="M17 2v20" />
                <path d="M2 12h20" />
                <path d="M2 7h5" />
                <path d="M2 17h5" />
                <path d="M17 17h5" />
                <path d="M17 7h5" />
              </svg>
            </div>
            <p className="text-text-muted text-lg font-bold">
              Henüz açık oda yok
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
