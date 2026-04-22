import { useState, useEffect } from 'react';
import { Platform, Alert } from 'react-native';
import { firebaseAuth } from '../lib/firebase';
import { syncAppleHealth } from '../lib/sync/appleSync';

// Conditionally import — only available in dev/production builds, not Expo Go
let AppleHealthKit = null;
try {
  AppleHealthKit = require('react-native-health').default;
} catch {
  // Running in Expo Go — HealthKit not available
}

const PERMISSIONS = {
  permissions: {
    read: [
      'Workout',
      'HeartRate',
      'DistanceWalkingRunning',
      'DistanceCycling',
      'DistanceSwimming',
      'ActiveEnergyBurned',
      'FlightsClimbed',
    ],
    write: [],
  },
};

export function useAppleHealthConnect() {
  const [connected, setConnected] = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [available, setAvailable] = useState(false);

  const userId = firebaseAuth.currentUser?.uid;

  useEffect(() => {
    setAvailable(Platform.OS === 'ios' && AppleHealthKit !== null);
  }, []);

  async function connect() {
    if (!available) {
      Alert.alert('Not available', 'Apple Health is only available on iPhone with a dev build.');
      return;
    }

    AppleHealthKit.initHealthKit(PERMISSIONS, async (err) => {
      if (err) {
        Alert.alert('Access denied', 'Please allow Health access in Settings → Privacy → Health → Lauver.');
        return;
      }

      setConnected(true);
      await syncWorkouts();
    });
  }

  async function syncWorkouts() {
    if (!userId || !available || !connected) return;
    setSyncing(true);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    AppleHealthKit.getSamples(
      {
        startDate: since,
        endDate:   new Date().toISOString(),
        type:      'Workout',
        ascending: false,
        limit:     100,
      },
      async (err, workouts) => {
        if (!err && workouts?.length) {
          try {
            await syncAppleHealth(userId, workouts);
          } catch (e) {
            console.warn('Apple Health sync error:', e.message);
          }
        }
        setSyncing(false);
      }
    );
  }

  function disconnect() {
    // HealthKit has no revoke API — user must revoke in iPhone Settings
    setConnected(false);
    Alert.alert(
      'Disconnected',
      'To fully revoke access go to Settings → Privacy & Security → Health → Lauver and turn off all permissions.'
    );
  }

  return { connected, syncing, available, connect, disconnect, syncWorkouts };
}
