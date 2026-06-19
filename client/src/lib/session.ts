const SESSION_KEY = 'you_together_session';

export interface RoomSession {
  roomId: string;
  userId: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
}

export function saveSession(session: RoomSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage unavailable (private browsing, quota exceeded)
  }
}

export function getSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomSession;
    // Validate basic shape
    if (!parsed.roomId || !parsed.userId || !parsed.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function hasSessionForRoom(roomId: string): boolean {
  const session = getSession();
  return session !== null && session.roomId === roomId;
}
