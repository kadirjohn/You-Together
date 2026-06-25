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

// Bir sayı dizisinin medyanı (watchparty utils.ts:342-362). Drift düzeltmede
// leader fallback'i için kullanılır: admin tsMap değeri yoksa (>2 izleyici)
// median lider kabul edilir — tek yavaş/buffering viewer'a karşı dayanıklı.
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
