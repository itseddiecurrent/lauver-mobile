CREATE TABLE strava_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status VARCHAR(30) NOT NULL CHECK (status IN ('connected','revocation_pending','reconnect_required')),
  athlete_id VARCHAR(30) NOT NULL,
  athlete_name VARCHAR(201) NOT NULL,
  scopes VARCHAR(500) NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at BIGINT NOT NULL CHECK (expires_at > 0),
  last_synced_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX strava_connections_status_idx ON strava_connections(status);
CREATE TABLE strava_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX strava_oauth_states_expires_at_idx ON strava_oauth_states(expires_at);
CREATE TABLE strava_activities (
  user_id UUID NOT NULL REFERENCES strava_connections(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider_activity_id VARCHAR(30) NOT NULL,
  title VARCHAR(500) NOT NULL,
  sport VARCHAR(80) NOT NULL,
  started_at TIMESTAMPTZ(3) NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  distance_meters DOUBLE PRECISION NOT NULL CHECK (distance_meters >= 0 AND distance_meters <= 100000000),
  PRIMARY KEY (user_id,provider_activity_id)
);
CREATE INDEX strava_activities_user_id_started_at_idx ON strava_activities(user_id,started_at);
