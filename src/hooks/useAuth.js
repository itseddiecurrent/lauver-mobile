import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { firebaseAuth } from '../lib/firebase';
import { syncFirebaseToSupabase } from '../lib/supabase';

/**
 * Firebase is the auth source of truth.
 * Whenever Firebase reports a user change, we sync to Supabase
 * so both sessions stay in lockstep.
 */
export function useAuth() {
  const [user, setUser]       = useState(undefined); // undefined = still loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      try {
        await syncFirebaseToSupabase(firebaseUser);
      } catch (e) {
        // Supabase sync failed — auth still works via Firebase alone
        console.warn('Supabase sync error:', e.message);
      }
      setUser(firebaseUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, loading };
}
