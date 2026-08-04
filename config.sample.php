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
define('CPANEL_HOST', 'mi3-tr2.supercp.com'); // cPanel access hostname for :2083 — taken from the cPanel login URL (NOT the site's public domain)
define('CPANEL_USERNAME', 'hubthegreenkiss');
define('CPANEL_API_TOKEN', 'PASTE_A_REAL_TOKEN_HERE'); // cPanel → Security → Manage API Tokens
define('CPANEL_REPO_PATH', '/home/hubthegreenkiss/repositories/greenkiss');

// ── Omnisend (Content Calendar → email metrics) ─────────────────────────
// API key from Omnisend → Store settings → Integrations & API → API keys.
// Leave as the placeholder and the email-metrics buttons return a clear
// "not configured" error instead of a fatal. Key stays server-side only.
define('OMNISEND_API_KEY', 'PASTE_A_REAL_OMNISEND_API_KEY_HERE');

// ── Shopify (Store Update → sales vs targets) ───────────────────────────
// Legacy "custom apps" (the copy-a-static-token flow) were retired 2026-01-01,
// so this uses a Dev Dashboard app with the client_credentials grant instead:
// Shopify admin → Settings → Apps and sales channels → Develop apps → "Build
// apps in Dev Dashboard" → Create app → give it the Admin API scope read_orders
// → install it on this store → Settings → copy the Client ID and Client secret.
// The server exchanges these for a short-lived token on each request; nothing
// is copied by hand and no token expires on us. Domain is the permanent
// *.myshopify.com one (Settings → Domains), e.g. thegreenkiss.myshopify.com.
// Leave placeholders and the Store Update gauges show a clear "connect Shopify"
// state. Credentials stay server-side only.
define('SHOPIFY_STORE_DOMAIN', 'PASTE_YOUR_STORE.myshopify.com');
define('SHOPIFY_CLIENT_ID', 'PASTE_YOUR_SHOPIFY_CLIENT_ID_HERE');
define('SHOPIFY_CLIENT_SECRET', 'PASTE_YOUR_SHOPIFY_CLIENT_SECRET_HERE');
define('SHOPIFY_API_VERSION', '2025-07'); // bump to a newer stable version as Shopify releases them
// Optional: only used if the app can't read shop.json for the store's timezone
// (day boundaries for "today"/"month-to-date"). IANA name, e.g. America/Vancouver.
// define('SHOPIFY_TIMEZONE', 'America/Vancouver');

// ── Off-site backups (Backblaze B2) ─────────────────────────────────────
// A SECOND copy of every backup, pushed to B2 by the daily cron. Without this
// there is exactly one copy, on the same cPanel account as the database — one
// deleted or compromised account loses both. B2's free tier is 10 GB.
//
// Setup (one time, two values to copy) — see DEPLOY.md section 5a:
//   1. backblaze.com → B2 Cloud Storage → Create a Bucket. Name it anything;
//      set it PRIVATE (these dumps contain password hashes).
//   2. Application Keys → Add a New Application Key. Scope it to just that
//      bucket ("Allow access to Bucket: <yours>") and give it Read and Write.
//   3. Copy keyID and applicationKey below. The key is shown ONCE — if you
//      lose it, delete the key and make another.
// Because the key is bucket-scoped, B2_BUCKET_ID can stay as-is: the server
// reads the bucket from the key itself. Only set it if you used an unscoped key.
// Leave the placeholders and off-site copies are skipped; local backups are
// unaffected and Admin Panel says so.
define('B2_KEY_ID', 'PASTE_YOUR_B2_KEY_ID_HERE');
define('B2_APPLICATION_KEY', 'PASTE_YOUR_B2_APPLICATION_KEY_HERE');
define('B2_BUCKET_ID', 'PASTE_ONLY_IF_YOUR_KEY_IS_NOT_BUCKET_SCOPED');
// Folder prefix inside the bucket. Created implicitly.
define('B2_FOLDER', 'greenkiss-backups');
