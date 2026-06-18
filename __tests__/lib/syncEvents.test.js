import { syncEvents } from '../../src/lib/syncEvents';

describe('syncEvents', () => {
  afterEach(() => {
    // Clear all listeners between tests
    Object.keys(syncEvents._listeners ?? {}).forEach(k => delete syncEvents._listeners?.[k]);
    // Reset internal listeners map via off round-trip
  });

  test('on + emit calls the listener', () => {
    const fn = jest.fn();
    syncEvents.on('activitiesChanged', fn);
    syncEvents.emit('activitiesChanged', { imported: 5 });
    expect(fn).toHaveBeenCalledWith({ imported: 5 });
    syncEvents.off('activitiesChanged', fn);
  });

  test('off removes the listener', () => {
    const fn = jest.fn();
    syncEvents.on('activitiesChanged', fn);
    syncEvents.off('activitiesChanged', fn);
    syncEvents.emit('activitiesChanged', {});
    expect(fn).not.toHaveBeenCalled();
  });

  test('multiple listeners all fire', () => {
    const a = jest.fn();
    const b = jest.fn();
    syncEvents.on('activitiesChanged', a);
    syncEvents.on('activitiesChanged', b);
    syncEvents.emit('activitiesChanged', { imported: 3 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    syncEvents.off('activitiesChanged', a);
    syncEvents.off('activitiesChanged', b);
  });

  test('emit on unknown event does not throw', () => {
    expect(() => syncEvents.emit('nonexistent', {})).not.toThrow();
  });

  test('off on unknown event does not throw', () => {
    const fn = jest.fn();
    expect(() => syncEvents.off('nonexistent', fn)).not.toThrow();
  });

  test('payload is passed through correctly', () => {
    const fn = jest.fn();
    syncEvents.on('activitiesChanged', fn);
    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 12 });
    expect(fn).toHaveBeenCalledWith({ platform: 'strava', imported: 12 });
    syncEvents.off('activitiesChanged', fn);
  });
});
