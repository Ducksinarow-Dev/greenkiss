# Deploying The Green Kiss to cPanel

One-time setup, then every future release is just `npm run release`.

## 1. Database

1. cPanel → **MySQL Databases** → create a database (e.g. `youruser_greenkiss`) and a user with all privileges on it. Note the host (usually `localhost`), db name, user, password.
2. cPanel → **phpMyAdmin** → select the new database → **Import** → upload `schema.sql` from this repo.
   - This creates `kv_store`, `users`, `tokens`, `revisions`, and seeds two admin users: **Hayden** and **Megan**, both PIN **1234**. Admin Panel access is role-gated (role=admin), not name-gated — these two are simply the only seeded admins.
   - **Both should change their PIN immediately after first login** (Sidebar → click your name → Change my PIN, or Admin Panel → Users → edit).

## 2. Server config

1. Copy `config.sample.php` to `config.php` **on the server**, next to where `api.php` will live (same folder). This file is gitignored — it never comes from a deploy, so it survives every release untouched.
2. Fill in `config.php` with the real `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASS` from step 1, and a random `CRON_KEY` (generate one with `php -r "echo bin2hex(random_bytes(24));"` or any long random string).
3. Make sure the app folder is writable by PHP — `uploads/` and `backups/` are created automatically on first use, each with their own `.htaccess` (uploads stays servable but can't execute PHP; backups is fully denied from the web).

## 3. Git Version Control (cPanel)

1. cPanel → **Git Version Control** → **Create** → clone this repo's URL.
2. Set the repository path to somewhere OUTSIDE `public_html` (cPanel manages the checkout separately from the deployed site).
3. After cloning, edit `.cpanel.yml` in the repo **once**: set `DEPLOYPATH` to your real cPanel username + the folder under `public_html` this app lives in. Commit that change straight to the `release` branch on the server if cPanel lets you edit in place, or just deploy once and edit-then-redeploy — either way it's a single line.
4. Checkout the **`release`** branch (not `main` — `main` is source, `release` is build output only).
5. Enable **"Update from Remote on Push"** if your git host supports webhooks to cPanel, otherwise click **Manage → Pull or Deploy** manually after each `npm run release`.
6. Deploy. `.cpanel.yml`'s task copies build files into `public_html` with `cp -R` — it never deletes anything, so `config.php`, `uploads/`, and `backups/` (none of which exist in the repo) are always left alone.

## 4. Cron (daily backups)

cPanel → **Cron Jobs** → add a daily job:

```
curl -s "https://YOURSITE/api.php?action=backup_run&cron_key=YOUR_CRON_KEY" >/dev/null
```

Use the same `CRON_KEY` value you put in `config.php`. (Backups also run automatically and lazily on any write if the newest one is over 24h old, so this cron is a belt-and-suspenders guarantee, not the only mechanism.)

## 5. First login

Visit the site, log in as **Hayden** or **Megan** / PIN **1234**, then immediately change the PIN (Sidebar → your name → Change my PIN). Add real staff accounts from Admin Panel → Users — non-admin staff default to editor (SOP/task/project/content work) or viewer (read-only); only Hayden and Megan need the admin role.

---

## How releases work

**`npm run release` is the only deploy path.** From your local checkout of `main`:

```
npm run release
```

This bumps the patch version (its own `Release: vX.Y.Z` commit), runs `npm run check` (eslint + a validation build), builds for real, copies `api.php` + a generated `VERSION` file + `.cpanel.yml` into `dist/`, replaces the `release` branch's contents with `dist/` via a temporary worktree, and pushes both `release` and `main`.

If cPanel's deploy-on-push is enabled, the site updates automatically within a minute or two of the script finishing. Otherwise go to cPanel → Git Version Control → this repo → **Manage → Pull or Deploy**.

The running build's version shows as small print at the bottom of the Sidebar ("Build vX.Y.Z · commit · date"). Compare that against the latest `Release: vX.Y.Z` commit on `main` to check whether the live site is caught up.

Never hand-edit `package.json`'s version, and never push straight to `release` — always go through `npm run release`.
