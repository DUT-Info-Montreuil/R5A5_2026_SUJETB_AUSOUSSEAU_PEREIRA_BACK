-- Annule 002_auth. Les colonnes d'origine de users ne sont pas touchées
DROP TABLE IF EXISTS login_failures;
DROP TABLE IF EXISTS refresh_tokens;
DROP INDEX IF EXISTS uq_users_email_lower;
DROP TRIGGER IF EXISTS trg_users_public_id_required;
DROP INDEX IF EXISTS uq_users_public_id;
ALTER TABLE users DROP COLUMN token_version;
ALTER TABLE users DROP COLUMN public_id;
