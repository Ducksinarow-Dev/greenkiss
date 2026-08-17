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
5. **Leave "Update from Remote on Push" / deploy-on-push OFF.** Deploys are now gated behind the app's own **Admin Panel → Software Update → Update Now** button (see below) so a code push never redeploys mid-shift while staff are using live data. cPanel's own **Manage → Pull or Deploy** page still works as a manual fallback if the in-app button ever fails.
6. Deploy once manually to get the site live initially. `.cpanel.yml`'s task copies build files into `public_html` with `cp -R` — it never deletes anything, so `config.php`, `uploads/`, and `backups/` (none of which exist in the repo) are always left alone.

## 4. Deploy button (Admin Panel → Software Update)

The app can trigger its own cPanel deploy instead of relying on deploy-on-push. This needs a cPanel API token:

1. cPanel → **Security** → **Manage API Tokens** → **Create** → give it a name (e.g. `greenkiss-deploy`) → copy the token immediately (shown once).
2. In `config.php` on the server, fill in:
   ```php
   define('CPANEL_HOST', 'mi3-tr2.supercp.com'); // the host used for :2083 access — taken from the cPanel login URL (differs from the site's public domain on this host)
   define('CPANEL_USERNAME', 'hubthegreenkiss');
   define('CPANEL_API_TOKEN', 'the token you just copied');
   define('CPANEL_REPO_PATH', '/home/hubthegreenkiss/repositories/greenkiss'); // the repository path from step 3 above
   ```
3. Until these are filled in, the Update Now button returns a clear "not configured yet" error rather than failing silently.

Once configured, an admin can click **Update Now** in Admin Panel any time after a `npm run release` has landed on the `release` branch. It takes a fresh backup, attempts to bring cPanel's checkout up to date with GitHub, then triggers the deploy — same effect as clicking cPanel's own **Manage → Pull or Deploy**, just gated behind an explicit in-app click instead of happening automatically on push.

## 5. Cron (daily backups)

cPanel → **Cron Jobs** → add a daily job:

```
curl -s "https://YOURSITE/api.php?action=backup_run&cron_key=YOUR_CRON_KEY" >/dev/null
```

Use the same `CRON_KEY` value you put in `config.php`. Backups also run automatically on any write if the newest one is over **6h** old, so this cron is not the only mechanism — but it IS the only thing that makes the **off-site copy** below happen, so don't skip it.

### 5a. Off-site backup copy (Backblaze B2)

Without this there is exactly **one** copy of your data, on the same cPanel account as the database — one deleted or compromised account loses both. The daily cron above pushes a second copy to Backblaze B2. Free tier is 10 GB, which is thousands of these dumps.

Local snapshots are 6-hourly; off-site copies are **daily** (they ride the cron only). That's deliberate: uploading on every 6-hourly snapshot would add a second of latency to whichever staff member's save happened to trigger it.

One-time setup — two values to copy, no OAuth:

1. <https://www.backblaze.com> → sign up → **B2 Cloud Storage** → **Create a Bucket**. Name it anything. Set it **Private** — these dumps contain password hashes.
2. **Application Keys** → **Add a New Application Key**. Under *Allow access to Bucket*, pick the bucket you just made (not "All"), and give it **Read and Write**.
3. Copy **keyID** and **applicationKey** into `config.php` as `B2_KEY_ID` and `B2_APPLICATION_KEY`. The applicationKey is displayed **once** — if you navigate away, delete the key and create another.
4. Leave `B2_BUCKET_ID` on its placeholder. Because the key is scoped to one bucket, the server reads the bucket from the key itself. Only fill it in if you used an unscoped ("All") key.
5. Confirm it works: **Admin Panel → Backups → Back up now**. The tile shows *"Copied off-site to Backblaze B2"* on success, or a red failure row carrying B2's own error text.

**Check that row occasionally.** Admin Panel → Backups shows the last off-site result and displays failures in red. An automated copy that silently stopped is the one failure mode that looks exactly like success right up until you need it. If the key is ever deleted or the bucket renamed, that row is where you'll find out.

Leave the `PASTE_…` placeholders and off-site copies are skipped entirely; local backups are unaffected and the tile says so.

Uploads use B2's native API (plain Basic auth) rather than its S3-compatible endpoint, which would need AWS SigV4 request signing for no benefit here. Files are versioned by B2 rather than overwritten, so a repeated filename never destroys the earlier copy. Old off-site copies are **not** pruned automatically — set a bucket Lifecycle Rule in B2 if you ever want that; at daily dumps of this size, 10 GB lasts years.

To use Dropbox or Cloudflare R2 instead, replace `b2Authorize()` and `offsiteUpload()` in `api.php` — the status reporting and failure UI are destination-agnostic.

### 5b. Backup format bumps wipe old snapshots

`GK_BACKUP_FORMAT` in `api.php` is the version of the dump's shape. When a table joins the backup, that number goes up — and the first request after the deploy deletes every existing snapshot in `backups/`, because an older dump doesn't restore the new table, it *deletes* it (restore empties every table it manages before reinserting). Restoring a stale-format file is also refused outright, which covers off-site copies pulled back from B2 by hand.

Practical effect: **history restarts at the first backup after such a deploy.** If you want a pre-deploy snapshot kept, download it (Admin Panel → Backups) before updating, and keep it as an archive — it won't be restorable through the app.

Format 2 (chat + per-record tables) is the current version.

## 6. First login

Visit the site, log in as **Hayden** or **Megan** / PIN **1234**, then immediately change the PIN (Sidebar → your name → Change my PIN). Add real staff accounts from Admin Panel → Users — non-admin staff default to editor (SOP/task/project/content work) or viewer (read-only); only Hayden and Megan need the admin role.

---

## How releases work

**`npm run release` is the only deploy path.** From your local checkout of `main`:

```
npm run release
```

This bumps the patch version (its own `Release: vX.Y.Z` commit), runs `npm run check` (eslint + a validation build), builds for real, copies `api.php` + a generated `VERSION` file + `.cpanel.yml` into `dist/`, replaces the `release` branch's contents with `dist/` via a temporary worktree, and pushes both `release` and `main`.

**This does NOT deploy to the live site.** Pushing to `release` only updates GitHub — the live site stays exactly as it was until an admin clicks **Admin Panel → Software Update → Update Now** in the app (see section 4 above), or uses cPanel's **Manage → Pull or Deploy** as a manual fallback. This is deliberate: staff may be using the app live, and an unreviewed deploy mid-shift is a real risk. Deploy-on-push should stay OFF in cPanel's Git Version Control settings.

The running build's version shows as small print at the bottom of the Sidebar ("Build vX.Y.Z · commit · date"), and as "Currently deployed" in Admin Panel → Software Update (which also shows whether the `release` branch on GitHub has a newer commit pending). Compare either against the latest `Release: vX.Y.Z` commit on `main` to check whether the live site is caught up.

Never hand-edit `package.json`'s version, and never push straight to `release` — always go through `npm run release`.
