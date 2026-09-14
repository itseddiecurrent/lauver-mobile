import { Pool, type PoolClient } from 'pg';
import { StravaError, type StravaActivity } from './strava-provider.js';

export type StravaConnectionRecord = {
  user_id: string; status: 'connected' | 'revocation_pending' | 'reconnect_required'; athlete_id: string;
  athlete_name: string; scopes: string; access_token_encrypted: string; refresh_token_encrypted: string;
  expires_at: number; last_synced_at: string | null;
};
export interface StravaStore {
  active(): Promise<boolean>;
  connection(): Promise<StravaConnectionRecord | null>;
  saveConnection(value: StravaConnectionRecord): Promise<void>;
  createState(hash: string): Promise<void>;
  consumeState(hash: string): Promise<boolean>;
  clearStates(): Promise<void>;
  clearConnection(): Promise<void>;
  replaceActivities(activities: StravaActivity[]): Promise<void>;
  activities(): Promise<StravaActivity[]>;
  setStatus(status: StravaConnectionRecord['status']): Promise<void>;
}
export interface StravaRepository {
  ownerOfState(hash: string): Promise<string | null>;
  locked<T>(userID: string, operation: (store: StravaStore) => Promise<T>): Promise<T>;
  pendingOwners(): Promise<string[]>;
  pruneStates(): Promise<void>;
}

// Session advisory locks serialize callback, token rotation and disconnect across
// server instances. Writes autocommit so a later provider failure cannot roll back
// the newest refresh token or resurrect a consumed OAuth state.
export class PgStravaRepository implements StravaRepository {
  private readonly pool: Pool;
  constructor(databaseURL: string) {
    this.pool = new Pool({ connectionString: databaseURL, max: 3, connectionTimeoutMillis: 3_000 });
    this.pool.on('error', () => { /* The affected request fails; no credentials are logged. */ });
  }
  async close(): Promise<void> { await this.pool.end(); }
  async ownerOfState(hash: string): Promise<string | null> {
    return (await this.pool.query<{ user_id: string }>('SELECT user_id FROM strava_oauth_states WHERE state_hash=$1 AND expires_at>now()', [hash])).rows[0]?.user_id ?? null;
  }
  async locked<T>(userID: string, operation: (store: StravaStore) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); let locked = false, broken = false;
    try {
      locked = (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,8)) AS locked', [userID])).rows[0]!.locked;
      if (!locked) throw new StravaError(409, 'strava_busy', 'Another Strava request is in progress. Please try again.');
      return await operation(new PgStravaStore(client, userID));
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,8))', [userID]); }
        catch { broken = true; }
      }
      client.release(broken);
    }
  }
  async pendingOwners(): Promise<string[]> {
    return (await this.pool.query<{ user_id: string }>("SELECT user_id FROM strava_connections WHERE status='revocation_pending' ORDER BY updated_at,user_id LIMIT 50")).rows.map(row => row.user_id);
  }
  async pruneStates(): Promise<void> { await this.pool.query('DELETE FROM strava_oauth_states WHERE expires_at<=now()'); }
}

class PgStravaStore implements StravaStore {
  constructor(private readonly client: PoolClient, private readonly userID: string) {}
  async active(): Promise<boolean> {
    return (await this.client.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE'", [this.userID])).rowCount === 1;
  }
  async connection(): Promise<StravaConnectionRecord | null> {
    return (await this.client.query<StravaConnectionRecord>(`SELECT user_id,status,athlete_id,athlete_name,scopes,
      access_token_encrypted,refresh_token_encrypted,expires_at::float8,
      CASE WHEN last_synced_at IS NULL THEN NULL ELSE to_char(last_synced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS last_synced_at
      FROM strava_connections WHERE user_id=$1`, [this.userID])).rows[0] ?? null;
  }
  async saveConnection(value: StravaConnectionRecord): Promise<void> {
    await this.client.query(`INSERT INTO strava_connections(user_id,status,athlete_id,athlete_name,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,last_synced_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id) DO UPDATE SET status=$2,athlete_id=$3,athlete_name=$4,scopes=$5,
      access_token_encrypted=$6,refresh_token_encrypted=$7,expires_at=$8,last_synced_at=$9,updated_at=now()`,
    [this.userID, value.status, value.athlete_id, value.athlete_name, value.scopes, value.access_token_encrypted, value.refresh_token_encrypted, value.expires_at, value.last_synced_at]);
  }
  async createState(hash: string): Promise<void> {
    await this.client.query(`INSERT INTO strava_oauth_states(state_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET state_hash=$1,expires_at=now()+interval '10 minutes',created_at=now()`, [hash,this.userID]);
  }
  async consumeState(hash: string): Promise<boolean> {
    return (await this.client.query('DELETE FROM strava_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING user_id', [hash,this.userID])).rowCount === 1;
  }
  async clearStates(): Promise<void> { await this.client.query('DELETE FROM strava_oauth_states WHERE user_id=$1', [this.userID]); }
  async clearConnection(): Promise<void> {
    // Activity FK cascade also clears summaries after successful revocation.
    await this.client.query('DELETE FROM strava_connections WHERE user_id=$1', [this.userID]);
  }
  async replaceActivities(activities: StravaActivity[]): Promise<void> {
    await this.client.query('BEGIN');
    try {
      // Replace the bounded latest window: removed/private activities do not remain cached.
      await this.client.query('DELETE FROM strava_activities WHERE user_id=$1', [this.userID]);
      for (const activity of activities) {
        await this.client.query(`INSERT INTO strava_activities(user_id,provider_activity_id,title,sport,started_at,duration_seconds,distance_meters)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,provider_activity_id) DO UPDATE SET title=$3,sport=$4,started_at=$5,duration_seconds=$6,distance_meters=$7`,
        [this.userID,activity.id,activity.title,activity.sport,activity.startedAt,activity.durationSeconds,activity.distanceMeters]);
      }
      await this.client.query('UPDATE strava_connections SET last_synced_at=now(),updated_at=now() WHERE user_id=$1', [this.userID]);
      await this.client.query('COMMIT');
    } catch (error) { await this.client.query('ROLLBACK'); throw error; }
  }
  async activities(): Promise<StravaActivity[]> {
    return (await this.client.query<StravaActivity>(`SELECT provider_activity_id AS id,title,sport,
      to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt",
      duration_seconds AS "durationSeconds",distance_meters AS "distanceMeters"
      FROM strava_activities WHERE user_id=$1 ORDER BY started_at DESC,provider_activity_id DESC LIMIT 20`, [this.userID])).rows;
  }
  async setStatus(status: StravaConnectionRecord['status']): Promise<void> {
    await this.client.query('UPDATE strava_connections SET status=$2,updated_at=now() WHERE user_id=$1', [this.userID,status]);
    if (status !== 'connected') await this.replaceActivities([]);
  }
}
