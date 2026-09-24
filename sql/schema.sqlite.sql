-- =========================================================
-- Arch Rivals : schéma SQLite
-- Tables STRICT : SQLite refuse les valeurs du mauvais type
-- Dates stockées en TEXT au format ISO 8601 UTC
-- Booléens stockés en INTEGER (0 ou 1)
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 32),
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS games (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS game_roles (
  id      INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name    TEXT    NOT NULL,
  UNIQUE (game_id, name)
) STRICT;

CREATE TABLE IF NOT EXISTS tournaments (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  status      TEXT    NOT NULL DEFAULT 'registration_open'
              CHECK (status IN ('registration_open', 'registration_closed', 'in_progress', 'finished')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at   TEXT,
  started_at  TEXT,
  finished_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tournaments_name ON tournaments (name);

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 50),
  is_eliminated INTEGER NOT NULL DEFAULT 0 CHECK (is_eliminated IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tournament_id, name),
  UNIQUE (id, tournament_id)
) STRICT;

CREATE TABLE IF NOT EXISTS team_members (
  team_id       INTEGER NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  tournament_id INTEGER NOT NULL,
  role_id       INTEGER REFERENCES game_roles(id),
  is_captain    INTEGER NOT NULL DEFAULT 0 CHECK (is_captain IN (0, 1)),
  joined_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, tournament_id) REFERENCES teams (id, tournament_id) ON DELETE CASCADE,
  UNIQUE (tournament_id, user_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_captain_per_team
  ON team_members (team_id) WHERE is_captain = 1;

CREATE TABLE IF NOT EXISTS join_requests (
  id         INTEGER PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_request
  ON join_requests (team_id, user_id) WHERE status = 'pending';

-- round : 1 = quarts, 2 = demies, 3 = finale
CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
  position      INTEGER NOT NULL CHECK (position >= 1),
  team_a_id     INTEGER REFERENCES teams(id),
  team_b_id     INTEGER REFERENCES teams(id),
  score_a       INTEGER CHECK (score_a >= 0),
  score_b       INTEGER CHECK (score_b >= 0),
  winner_id     INTEGER REFERENCES teams(id),
  is_forfeit    INTEGER NOT NULL DEFAULT 0 CHECK (is_forfeit IN (0, 1)),
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ready', 'finished')),
  validated_at  TEXT,
  UNIQUE (tournament_id, round, position),
  CHECK (team_a_id IS NULL OR team_a_id <> team_b_id),
  CHECK (winner_id IS NULL OR winner_id IN (team_a_id, team_b_id)),
  CHECK (status <> 'finished' OR winner_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content    TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_messages_team_date ON messages (team_id, created_at);
