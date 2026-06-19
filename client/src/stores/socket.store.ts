import { create } from 'zustand';
import { getSocket } from '../lib/socket';

interface SocketStore {
  connected: boolean;
  socketId: string | null;
  setConnected: (connected: boolean) => void;
  setSocketId: (id: string | null) => void;
}

export const useSocketStore = create<SocketStore>((set) => {
  const socket = getSocket();

  socket.on('connect', () => {
    set({ connected: true, socketId: socket.id || null });
  });

  socket.on('disconnect', () => {
    set({ connected: false, socketId: null });
  });

  return {
    connected: socket.connected,
    socketId: socket.id || null,
    setConnected: (connected) => set({ connected }),
    setSocketId: (socketId) => set({ socketId }),
  };
});
