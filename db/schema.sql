-- Cherry Atlas KR PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));

CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_id TEXT NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS overpass_cache_entries (
  cache_key TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at BIGINT NOT NULL,
  stale_until BIGINT NOT NULL,
  elements JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS osm_cherry_spots (
  osm_key TEXT PRIMARY KEY,
  osm_type TEXT NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
  osm_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS osm_cherry_spots_status_idx ON osm_cherry_spots(status);
CREATE INDEX IF NOT EXISTS osm_cherry_spots_lat_lon_idx ON osm_cherry_spots(lat, lon);

CREATE TABLE IF NOT EXISTS place_snapshots (
  cache_key TEXT PRIMARY KEY,
  bbox JSONB NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  elements JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS internal_cherry_spots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_core BOOLEAN NOT NULL DEFAULT TRUE,
  min_zoom INTEGER NOT NULL DEFAULT 12,
  priority INTEGER NOT NULL DEFAULT 100,
  category TEXT NOT NULL DEFAULT 'hub',
  created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE internal_cherry_spots ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE internal_cherry_spots ADD COLUMN IF NOT EXISTS min_zoom INTEGER NOT NULL DEFAULT 12;
ALTER TABLE internal_cherry_spots ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE internal_cherry_spots ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'hub';
CREATE INDEX IF NOT EXISTS internal_cherry_spots_core_zoom_idx ON internal_cherry_spots(status, is_core, min_zoom, priority);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS curated_cherry_spots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
