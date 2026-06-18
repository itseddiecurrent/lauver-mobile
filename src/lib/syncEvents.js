// Minimal event emitter for cross-hook communication.
// Used to signal that activities were synced so Dashboard can refresh.

const listeners = {};

export const syncEvents = {
  on(event, fn) {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event].add(fn);
  },
  off(event, fn) {
    listeners[event]?.delete(fn);
  },
  emit(event, payload) {
    listeners[event]?.forEach(fn => fn(payload));
  },
};
