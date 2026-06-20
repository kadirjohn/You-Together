import { create } from 'zustand';
import type { PublicRoomState, RoomUser, ChatMessage, SyncTarget, VideoMeta, WatchedVideo } from '../lib/socket';
import { clearSession } from '../lib/session';

export type SyncStatus = 'idle' | 'synced' | 'slightly-off' | 'resyncing' | 'buffering';

interface RoomStore {
  room: PublicRoomState | null;
  currentUser: RoomUser | null;
  users: RoomUser[];
  chatMessages: ChatMessage[];
  syncStatus: SyncStatus;
  serverOffsetMs: number;
  applyingRemoteUpdate: boolean;
  lastRemoteVersion: number;
  playerReady: boolean;
  // Mevcut aktif videonun metası (süre + başlık + kanal).
  meta: VideoMeta | null;
  // Oda bazlı izlenen-videolar listesi (watch list).
  watchlist: WatchedVideo[];

  setRoom: (room: PublicRoomState | null) => void;
  setCurrentUser: (user: RoomUser | null) => void;
  setUsers: (users: RoomUser[]) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatHistory: (messages: ChatMessage[]) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setServerOffsetMs: (offset: number) => void;
  setApplyingRemoteUpdate: (v: boolean) => void;
  setLastRemoteVersion: (v: number) => void;
  setPlayerReady: (v: boolean) => void;
  setMeta: (meta: VideoMeta | null) => void;
  setWatchlist: (videos: WatchedVideo[]) => void;
  updatePlayback: (state: {
    videoId?: string | null;
    status?: string;
    baseTime?: number;
    baseServerTime?: number;
    version?: number;
    updatedBy?: string | null;
  }) => void;
  reset: () => void;
}

const initialState = {
  room: null,
  currentUser: null,
  users: [],
  chatMessages: [],
  syncStatus: 'idle' as SyncStatus,
  serverOffsetMs: 0,
  applyingRemoteUpdate: false,
  lastRemoteVersion: 0,
  playerReady: false,
  meta: null as VideoMeta | null,
  watchlist: [] as WatchedVideo[],
};

export const useRoomStore = create<RoomStore>((set, get) => ({
  ...initialState,

  setRoom: (room) => set({ room }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setUsers: (users) => set({ users }),
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-200),
    })),
  setChatHistory: (messages) => set({ chatMessages: messages }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setServerOffsetMs: (offset) => set({ serverOffsetMs: offset }),
  setApplyingRemoteUpdate: (v) => set({ applyingRemoteUpdate: v }),
  setLastRemoteVersion: (v) => set({ lastRemoteVersion: v }),
  setPlayerReady: (v) => set({ playerReady: v }),
  setMeta: (meta) => set({ meta }),
  setWatchlist: (videos) => set({ watchlist: videos }),

  updatePlayback: (playback) =>
    set((state) => {
      if (!state.room) return state;
      return {
        room: {
          ...state.room,
          playback: {
            ...state.room.playback,
            ...playback,
          },
        },
      };
    }),

  reset: () => {
    clearSession();
    set(initialState);
  },
}));
