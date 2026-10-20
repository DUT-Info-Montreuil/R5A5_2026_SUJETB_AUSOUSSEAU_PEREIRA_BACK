-- =========================================================
-- 002 : authentification (access + refresh, invalidation, ralentissement)
-- N'altère aucune colonne existante : ajoute seulement colonnes, index et tables
-- =========================================================

-- Identifiant public non devinable (UUID v4), exposé dans l'API et dans le `sub` des JWT.
-- L'id entier reste la clé interne (toutes les clés étrangères pointent dessus)
ALTER TABLE users ADD COLUMN public_id TEXT;

-- Lignes existantes : UUID v4 généré en SQL
UPDATE users SET public_id = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)
WHERE public_id IS NULL;

CREATE UNIQUE INDEX uq_users_public_id ON users (public_id);

-- ALTER TABLE ne peut pas ajouter un NOT NULL sans valeur par défaut : un trigger le garantit
CREATE TRIGGER trg_users_public_id_required
BEFORE INSERT ON users
WHEN NEW.public_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'users.public_id est obligatoire');
END;

-- Recopié dans chaque JWT : l'incrémenter invalide tous les jetons déjà émis
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0);

-- L'email est normalisé en minuscules par la validation ; l'index le garantit aussi en base
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

-- On ne stocke jamais le refresh token lui-même, seulement son identifiant (jti)
CREATE TABLE refresh_tokens (
  jti         TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Toutes les rotations d'une même connexion partagent la même famille
  family_id   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  replaced_by TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

-- Compteur d'échecs par identifiant saisi (qu'il existe ou non) :
-- on stocke le SHA-256 de l'email normalisé, pas l'email
CREATE TABLE login_failures (
  identifier_hash TEXT    PRIMARY KEY,
  failure_count   INTEGER NOT NULL CHECK (failure_count >= 1),
  next_allowed_at TEXT    NOT NULL,
  last_failure_at TEXT    NOT NULL
) STRICT;
