import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';

// Same 7-item checklist as ProfileScreen — keep in sync if adding fields.
export function progressFromProfile(p) {
  if (!p) return 0;
  const checks = [
    true,                          // account created
    true,                          // email verified
    Array.isArray(p.photos) && p.photos.length > 0,
    Array.isArray(p.sports) && p.sports.length > 0,
    !!p.city,
    !!p.bio,
    Array.isArray(p.availability) && p.availability.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function useProfile() {
  const { user } = useAuth();
  const [profile,  setProfile]  = useState(null);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('profiles')
      .select('photos, sports, city, bio, availability, display_name, avatar_url, skill, unit_distance, unit_elevation, unit_weight')
      .eq('id', user.uid)
      .maybeSingle();
    setProfile(data ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return { profile, progress: progressFromProfile(profile), loading, refresh: load };
}
