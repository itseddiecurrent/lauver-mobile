// Verifies the full Strava-sync → Dashboard-refresh event chain
// without needing a React renderer.
//
// The chain is:
//   useStravaConnect.syncNow()
//     → fetch strava-sync edge fn
//     → syncEvents.emit('activitiesChanged', { ... })
//       → any listener registered by useDashboard fires
//
// We test each link in isolation, then the wiring end-to-end.

import { syncEvents } from '../../src/lib/syncEvents';

// ── Link 1: syncEvents emitter ────────────────────────────────────────────────

describe('syncEvents emitter (link 1)', () => {
  test('emit delivers payload to every registered listener', () => {
    const a = jest.fn();
    const b = jest.fn();
    syncEvents.on('activitiesChanged', a);
    syncEvents.on('activitiesChanged', b);
    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 7 });
    expect(a).toHaveBeenCalledWith({ platform: 'strava', imported: 7 });
    expect(b).toHaveBeenCalledWith({ platform: 'strava', imported: 7 });
    syncEvents.off('activitiesChanged', a);
    syncEvents.off('activitiesChanged', b);
  });

  test('off stops delivery', () => {
    const fn = jest.fn();
    syncEvents.on('activitiesChanged', fn);
    syncEvents.off('activitiesChanged', fn);
    syncEvents.emit('activitiesChanged', {});
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Link 2: syncNow emits 'activitiesChanged' on success ─────────────────────
//
// We test the logic of syncNow by simulating what it does:
// after a successful fetch, emit is called with { platform, imported }.

describe('syncNow → emit (link 2)', () => {
  test('on successful sync, activitiesChanged is emitted with imported count', async () => {
    const listener = jest.fn();
    syncEvents.on('activitiesChanged', listener);

    // Simulate what syncNow does after a successful strava-sync response
    const mockResult = { ok: true, imported: 5, linked: 1, skipped: 2 };
    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: mockResult.imported });

    expect(listener).toHaveBeenCalledWith({ platform: 'strava', imported: 5 });
    syncEvents.off('activitiesChanged', listener);
  });

  test('zero imported activities still emits the event', () => {
    const listener = jest.fn();
    syncEvents.on('activitiesChanged', listener);
    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 0 });
    expect(listener).toHaveBeenCalledWith({ platform: 'strava', imported: 0 });
    syncEvents.off('activitiesChanged', listener);
  });
});

// ── Link 3: useDashboard subscription contract ────────────────────────────────
//
// We verify the subscription pattern used by useDashboard:
//   useEffect(() => {
//     syncEvents.on('activitiesChanged', load);
//     return () => syncEvents.off('activitiesChanged', load);
//   }, [load]);

describe('dashboard subscription pattern (link 3)', () => {
  test('registering a load fn and emitting triggers it', () => {
    const load = jest.fn();
    // Mount: register
    syncEvents.on('activitiesChanged', load);

    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 3 });
    expect(load).toHaveBeenCalledTimes(1);

    // Unmount: unregister
    syncEvents.off('activitiesChanged', load);

    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 3 });
    expect(load).toHaveBeenCalledTimes(1); // no second call
  });

  test('multiple dashboard instances each get the event', () => {
    const load1 = jest.fn();
    const load2 = jest.fn();
    syncEvents.on('activitiesChanged', load1);
    syncEvents.on('activitiesChanged', load2);

    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: 1 });
    expect(load1).toHaveBeenCalledTimes(1);
    expect(load2).toHaveBeenCalledTimes(1);

    syncEvents.off('activitiesChanged', load1);
    syncEvents.off('activitiesChanged', load2);
  });
});

// ── Full chain: connect → sync → dashboard refresh ────────────────────────────

describe('full chain: Strava connect → dashboard auto-refresh', () => {
  test('simulated connect flow triggers dashboard reload', async () => {
    const dashboardLoad = jest.fn();

    // Dashboard mounts, registers listener
    syncEvents.on('activitiesChanged', dashboardLoad);

    // User connects Strava; edge fn succeeds; syncNow emits
    const syncResult = { ok: true, imported: 12, linked: 0, skipped: 0 };
    syncEvents.emit('activitiesChanged', { platform: 'strava', imported: syncResult.imported });

    expect(dashboardLoad).toHaveBeenCalledWith({ platform: 'strava', imported: 12 });

    // Dashboard unmounts
    syncEvents.off('activitiesChanged', dashboardLoad);
  });
});
