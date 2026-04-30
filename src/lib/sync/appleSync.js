import { importActivity } from './importActivity';

const APPLE_SPORT_MAP = {
  HKWorkoutActivityTypeRunning:                    'running',
  HKWorkoutActivityTypeCycling:                    'cycling',
  HKWorkoutActivityTypeSwimming:                   'swimming',
  HKWorkoutActivityTypeHiking:                     'hiking',
  HKWorkoutActivityTypeWalking:                    'hiking',
  HKWorkoutActivityTypeTraditionalStrengthTraining:'gym',
  HKWorkoutActivityTypeFunctionalStrengthTraining: 'gym',
  HKWorkoutActivityTypeYoga:                       'yoga',
  HKWorkoutActivityTypeCrossCountrySkiing:         'skiing',
  HKWorkoutActivityTypeDownhillSkiing:             'skiing',
  HKWorkoutActivityTypeClimbing:                   'climbing',
};

export async function syncAppleHealth(userId, workouts) {
  const results = [];
  for (const w of workouts) {
    const sport = APPLE_SPORT_MAP[w.workoutActivityType] ?? 'other';
    const data = {
      sport,
      title:            `${sport.charAt(0).toUpperCase() + sport.slice(1)} Workout`,
      started_at:       w.startDate,
      duration_seconds: Math.round(w.duration ?? 0),
      distance_km:      w.totalDistance ? w.totalDistance / 1000 : null,
      avg_heart_rate:   null,
      calories:         w.totalEnergyBurned ?? null,
      elevation_gain_m: null,
    };

    const externalId = w.uuid ?? w.sourceRevision?.source?.bundleIdentifier + '_' + w.startDate;

    try {
      const result = await importActivity(userId, 'apple', externalId, data, w);
      results.push(result);
    } catch (e) {
      console.warn('Failed to import Apple Health workout:', e.message);
    }
  }
  return results;
}
