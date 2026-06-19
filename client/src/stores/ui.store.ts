import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  createdAt: number;
}

interface UIStore {
  showCreateModal: boolean;
  showJoinModal: boolean;
  joinRoomId: string | null;
  toasts: Toast[];
  setShowCreateModal: (v: boolean) => void;
  openJoinModal: (roomId: string) => void;
  closeJoinModal: () => void;
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
}

let toastId = 0;

export const useUIStore = create<UIStore>((set, get) => ({
  showCreateModal: false,
  showJoinModal: false,
  joinRoomId: null,
  toasts: [],

  setShowCreateModal: (v) => set({ showCreateModal: v }),

  openJoinModal: (roomId) => set({ showJoinModal: true, joinRoomId: roomId }),

  closeJoinModal: () => set({ showJoinModal: false, joinRoomId: null }),

  addToast: (message, type = 'info') => {
    const id = `toast_${++toastId}`;
    const toast: Toast = { id, message, type, createdAt: Date.now() };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
