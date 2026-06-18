import { STRAVA_SPORT_MAP, mapStravaActivity } from '../../src/lib/sync/stravaSync';

describe('STRAVA_SPORT_MAP', () => {
  const cases = [
    ['Run',              'running'],
    ['VirtualRun',       'running'],
    ['TrailRun',         'running'],
    ['Ride',             'cycling'],
    ['VirtualRide',      'cycling'],
    ['EBikeRide',        'cycling'],
    ['MountainBikeRide', 'cycling'],
    ['GravelRide',       'cycling'],
    ['Swim',             'swimming'],
    ['Rowing',           'swimming'],
    ['Hike',             'hiking'],
    ['Walk',             'hiking'],
    ['RockClimbing',     'climbing'],
    ['AlpineSki',        'skiing'],
    ['BackcountrySki',   'skiing'],
    ['NordicSki',        'skiing'],
    ['Snowboard',        'skiing'],
    ['WeightTraining',   'gym'],
    ['Crossfit',         'gym'],
    ['Workout',          'gym'],
    ['Yoga',             'yoga'],
    ['Pilates',          'yoga'],
    ['Kayaking',         'other'],
    ['Surfing',          'other'],
  ];

  test.each(cases)('%s → %s', (stravaType, expected) => {
    expect(STRAVA_SPORT_MAP[stravaType]).toBe(expected);
  });

  test('unknown types are not in the map', () => {
    expect(STRAVA_SPORT_MAP['FlyingCarpet']).toBeUndefined();
  });
});

describe('mapStravaActivity', () => {
  const base = {
    sport_type:          'Run',
    name:                'Morning 5K',
    start_date:          '2026-06-17T07:00:00Z',
    moving_time:         1800,
    distance:            5000,
    average_heartrate:   145,
    calories:            320,
    total_elevation_gain: 42,
  };

  test('maps a complete run activity', () => {
    const result = mapStravaActivity(base);
    expect(result).toEqual({
      sport:            'running',
      title:            'Morning 5K',
      started_at:       '2026-06-17T07:00:00Z',
      duration_seconds: 1800,
      distance_km:      5,
      avg_heart_rate:   145,
      calories:         320,
      elevation_gain_m: 42,
    });
  });

  test('distance is converted from meters to km with 2 decimals', () => {
    const result = mapStravaActivity({ ...base, distance: 10123 });
    expect(result.distance_km).toBe(10.12);
  });

  test('null distance stays null', () => {
    const result = mapStravaActivity({ ...base, distance: null });
    expect(result.distance_km).toBeNull();
  });

  test('missing distance stays null', () => {
    const { distance, ...noDistance } = base;
    const result = mapStravaActivity(noDistance);
    expect(result.distance_km).toBeNull();
  });

  test('null heart rate stays null', () => {
    const result = mapStravaActivity({ ...base, average_heartrate: null });
    expect(result.avg_heart_rate).toBeNull();
  });

  test('null calories stays null', () => {
    const result = mapStravaActivity({ ...base, calories: null });
    expect(result.calories).toBeNull();
  });

  test('null elevation stays null', () => {
    const result = mapStravaActivity({ ...base, total_elevation_gain: null });
    expect(result.elevation_gain_m).toBeNull();
  });

  test('falls back to legacy type field when sport_type unknown', () => {
    const result = mapStravaActivity({ ...base, sport_type: 'Unknown', type: 'Ride' });
    expect(result.sport).toBe('cycling');
  });

  test('unknown sport_type and type defaults to other', () => {
    const result = mapStravaActivity({ ...base, sport_type: 'FlyingCarpet', type: 'FlyingCarpet' });
    expect(result.sport).toBe('other');
  });

  test('empty name falls back to default title', () => {
    const result = mapStravaActivity({ ...base, name: '' });
    expect(result.title).toBe('Strava activity');
  });

  test('missing name falls back to default title', () => {
    const { name, ...noName } = base;
    const result = mapStravaActivity(noName);
    expect(result.title).toBe('Strava activity');
  });

  test('maps cycling correctly', () => {
    const result = mapStravaActivity({ ...base, sport_type: 'Ride' });
    expect(result.sport).toBe('cycling');
  });

  test('maps skiing correctly', () => {
    const result = mapStravaActivity({ ...base, sport_type: 'AlpineSki' });
    expect(result.sport).toBe('skiing');
  });

  test('maps gym correctly', () => {
    const result = mapStravaActivity({ ...base, sport_type: 'WeightTraining' });
    expect(result.sport).toBe('gym');
  });
});
