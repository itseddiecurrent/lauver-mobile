import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lauver_units';

export const KM_TO_MI = 0.621371;
export const M_TO_FT  = 3.28084;
export const KG_TO_LB = 2.20462;

export function makeDistFmt(unit) {
  return function fmtDistance(km) {
    if (km == null) return '—';
    if (unit === 'mi') return `${(km * KM_TO_MI).toFixed(1)} mi`;
    return `${parseFloat(km.toFixed(1))} km`;
  };
}

export function makeElevFmt(unit) {
  return function fmtElevation(m) {
    if (m == null) return '—';
    if (unit === 'ft') return `${Math.round(m * M_TO_FT)} ft`;
    return `${Math.round(m)} m`;
  };
}

export function makeWeightFmt(unit) {
  return function fmtWeight(kg) {
    if (kg == null) return '—';
    if (unit === 'lb') return `${(kg * KG_TO_LB).toFixed(1)} lb`;
    return `${parseFloat(kg.toFixed(1))} kg`;
  };
}

const DEFAULTS = { distUnit: 'km', elevUnit: 'm', weightUnit: 'kg' };

const UnitsContext = createContext({
  ...DEFAULTS,
  setDistUnit:   () => {},
  setElevUnit:   () => {},
  setWeightUnit: () => {},
  fmtDistance:   (km) => `${km ?? 0} km`,
  fmtElevation:  (m)  => `${m ?? 0} m`,
  fmtWeight:     (kg) => `${kg ?? 0} kg`,
});

export function UnitsProvider({ children }) {
  const [distUnit,   setDistUnitState]   = useState('km');
  const [elevUnit,   setElevUnitState]   = useState('m');
  const [weightUnit, setWeightUnitState] = useState('kg');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.distUnit)   setDistUnitState(saved.distUnit);
        if (saved.elevUnit)   setElevUnitState(saved.elevUnit);
        if (saved.weightUnit) setWeightUnitState(saved.weightUnit);
      })
      .catch(() => {});
  }, []);

  function persist(patch) {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        const current = raw ? JSON.parse(raw) : DEFAULTS;
        return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
      })
      .catch(() => {});
  }

  function setDistUnit(v)   { setDistUnitState(v);   persist({ distUnit: v }); }
  function setElevUnit(v)   { setElevUnitState(v);   persist({ elevUnit: v }); }
  function setWeightUnit(v) { setWeightUnitState(v); persist({ weightUnit: v }); }

  const value = useMemo(() => ({
    distUnit,
    elevUnit,
    weightUnit,
    setDistUnit,
    setElevUnit,
    setWeightUnit,
    fmtDistance:  makeDistFmt(distUnit),
    fmtElevation: makeElevFmt(elevUnit),
    fmtWeight:    makeWeightFmt(weightUnit),
  }), [distUnit, elevUnit, weightUnit]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnitsContext() {
  return useContext(UnitsContext);
}
