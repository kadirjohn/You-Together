export function generateId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(0, 4);
}
