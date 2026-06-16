import { useProfile } from './useProfile';

const KM_TO_MI = 0.621371;
const M_TO_FT  = 3.28084;

export function makeDistFmt(unit) {
  return function fmtDistance(km) {
    if (km == null) return '—';
    if (unit === 'mi') return `${(km * KM_TO_MI).toFixed(1)} mi`;
    return `${km} km`;
  };
}

export function makeElevFmt(unit) {
  return function fmtElevation(m) {
    if (m == null) return '—';
    if (unit === 'ft') return `${Math.round(m * M_TO_FT)} ft`;
    return `${m} m`;
  };
}

export function useUnits() {
  const { profile } = useProfile();
  const distUnit = profile?.unit_distance ?? 'km';
  const elevUnit = profile?.unit_elevation ?? 'm';
  return {
    distUnit,
    elevUnit,
    fmtDistance:  makeDistFmt(distUnit),
    fmtElevation: makeElevFmt(elevUnit),
  };
}
