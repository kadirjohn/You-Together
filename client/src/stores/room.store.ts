import { create } from 'zustand';
import type { PublicRoomState, RoomUser, ChatMessage, SyncTarget } from '../lib/socket';

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
  updatePlayback: (state: {
    videoId?: string | null;
    status?: string;
    baseTime?: number;
    baseServerTime?: number;
    version?: number;
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

  reset: () => set(initialState),
}));
