-- The Green Kiss — MySQL schema (utf8mb4)
-- Import this once via phpMyAdmin (or `mysql -u user -p dbname < schema.sql`)
-- after creating the database + user in cPanel. See DEPLOY.md.

SET NAMES utf8mb4;

-- ─── kv_store ─────────────────────────────────────────────────────────
-- General write-through key/value data: sops, categories, tasks, acks, etc.
-- Mirrors the client's localStorage db.get/db.set shape 1:1 — the value is
-- always a JSON string, decoded/encoded on the client.
CREATE TABLE IF NOT EXISTS kv_store (
  k          VARCHAR(191) NOT NULL PRIMARY KEY,
  v          LONGTEXT     NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         VARCHAR(16)  NOT NULL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  pin_hash   VARCHAR(255) NOT NULL,
  role       ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed users: Hayden + Megan, both admin, both PIN 1234 (bcrypt hashes below).
-- Admin Panel is restricted to these two (role-gated, not name-gated — see
-- api.php requireRole calls). CHANGE THESE PINS AFTER FIRST LOGIN — see DEPLOY.md.
INSERT INTO users (id, name, pin_hash, role, created_at)
VALUES ('u_hayden0', 'Hayden', '$2b$10$4SDOtPIlGc/nXwwkym1FTuEpixXNh3rE1wr4aDQdYbUm1ig2NqGvq', 'admin', UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO users (id, name, pin_hash, role, created_at)
VALUES ('u_megan00', 'Megan', '$2y$10$SYATm60c.gYR5woNgtW3dOCWRRYnwPE4r2lwz0TfNIoTWijUCL9MG', 'admin', UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = id;

-- Jessica + Liz — Editors, PIN 1234 (same bcrypt hash as Hayden's seed).
-- NOTE: schema.sql only seeds a FRESH database. On an already-live DB these
-- INSERTs won't run — add them via Admin Panel → Users, or run these two
-- statements once against the live DB. Both should change their PIN on first
-- login. See DEPLOY.md.
INSERT INTO users (id, name, pin_hash, role, created_at)
VALUES ('u_jessica', 'Jessica', '$2b$10$4SDOtPIlGc/nXwwkym1FTuEpixXNh3rE1wr4aDQdYbUm1ig2NqGvq', 'editor', UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO users (id, name, pin_hash, role, created_at)
VALUES ('u_liz0000', 'Liz', '$2b$10$4SDOtPIlGc/nXwwkym1FTuEpixXNh3rE1wr4aDQdYbUm1ig2NqGvq', 'editor', UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE id = id;

-- ─── tokens ───────────────────────────────────────────────────────────
-- Bearer session tokens. Expire after 30 days idle (pruned opportunistically
-- in api.php, not via a MySQL event — keeps hosting requirements minimal).
CREATE TABLE IF NOT EXISTS tokens (
  token      VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id    VARCHAR(16) NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tokens_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── login_sessions ───────────────────────────────────────────────────
-- Staff sign-in history (Batch 1). One row per login. login_at is set on
-- login; last_seen advances on every authenticated request (so it doubles
-- as "last activity"); logout_at is set on explicit logout. A session with
-- no logout_at whose last_seen is >30 min stale is treated as idle-ended at
-- last_seen (derived on the client, no cron needed). api.php also creates
-- this table lazily (ensureLoginSessionsTable) so an already-live DB picks
-- it up on the next deploy without a manual import.
CREATE TABLE IF NOT EXISTS login_sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  token      VARCHAR(64)  NOT NULL,
  user_id    VARCHAR(16)  NOT NULL,
  user_name  VARCHAR(100) NULL,
  login_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_at  DATETIME     NULL,
  INDEX idx_login_sessions_user (user_id),
  INDEX idx_login_sessions_login (login_at),
  INDEX idx_login_sessions_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── revisions ────────────────────────────────────────────────────────
-- SOP version history. Capped at 20 snapshots per sop_id (oldest pruned on
-- insert — see sop_save / revision_restore in api.php).
CREATE TABLE IF NOT EXISTS revisions (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  sop_id    VARCHAR(16)  NOT NULL,
  snapshot  LONGTEXT     NOT NULL,
  saved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_by  VARCHAR(100) NULL,
  INDEX idx_revisions_sop (sop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
