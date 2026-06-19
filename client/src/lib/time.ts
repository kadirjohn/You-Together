export function now(): number {
  return Date.now();
}

export function estimateServerNow(serverOffsetMs: number): number {
  return now() + serverOffsetMs;
}

export function computeExpectedRoomTime(
  state: { baseTime: number; baseServerTime: number; status: string },
  serverOffsetMs: number,
): number {
  if (state.status === 'paused' || state.status === 'idle') {
    return state.baseTime;
  }

  const estimatedServerNow = now() + serverOffsetMs;
  return state.baseTime + (estimatedServerNow - state.baseServerTime) / 1000;
}
