export function now(): number {
  return Date.now();
}

export function computeCurrentRoomTime(state: {
  baseTime: number;
  baseServerTime: number;
  status: string;
}): number {
  if (state.status === 'paused' || state.status === 'idle') {
    return state.baseTime;
  }
  // playing or buffering — continue counting
  return state.baseTime + (now() - state.baseServerTime) / 1000;
}

export function hoursToSeconds(h: number): number {
  return h * 60 * 60;
}

export function minutesToSeconds(m: number): number {
  return m * 60;
}
