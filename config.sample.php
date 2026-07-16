<?php
/**
 * The Green Kiss — server config template.
 *
 * Copy this file to config.php (same folder) and fill in real values.
 * config.php is gitignored — it holds secrets and never gets committed,
 * and a deploy never overwrites it (see DEPLOY.md).
 */

// ── Database (create via cPanel → MySQL Databases, then import schema.sql
//    via phpMyAdmin — see DEPLOY.md) ────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'cpaneluser_greenkiss');
define('DB_USER', 'cpaneluser_gkapp');
define('DB_PASS', 'PASTE_A_REAL_DB_PASSWORD_HERE');

// ── Cron backup secret ──────────────────────────────────────────────────
// Any long random string. Put the SAME value in your cPanel cron command,
// e.g.: curl -s "https://SITE/api.php?action=backup_run&cron_key=THIS_VALUE"
// Generate one with: php -r "echo bin2hex(random_bytes(24));"
define('CRON_KEY', 'PASTE_A_LONG_RANDOM_STRING_HERE');

// ── Optional overrides ──────────────────────────────────────────────────
// Leave commented to use the default uploads/ and backups/ folders that
// api.php creates next to itself.
// define('UPLOADS_DIR', __DIR__ . '/uploads');
// define('BACKUPS_DIR', __DIR__ . '/backups');

// ── Deploy button (Admin Panel → Software Update) ───────────────────────
// Lets an admin trigger a cPanel Git Version Control deploy from inside the
// app itself, instead of deploy-on-push happening automatically the instant
// code lands on the `release` branch. See DEPLOY.md for how to get the API
// token and confirm the access hostname. Leave CPANEL_API_TOKEN as the
// placeholder below and the Update Now button will return a clear
// "not configured yet" error instead of a PHP fatal.
define('CPANEL_HOST', 'hub.thegreenkiss.com'); // cPanel access hostname for :2083 — confirm this is right, some hosts use a different hostname than the site's public domain
define('CPANEL_USERNAME', 'hubthegreenkiss');
define('CPANEL_API_TOKEN', 'PASTE_A_REAL_TOKEN_HERE'); // cPanel → Security → Manage API Tokens
define('CPANEL_REPO_PATH', '/home/hubthegreenkiss/repositories/greenkiss');
