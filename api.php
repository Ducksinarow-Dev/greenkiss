<?php
/**
 * The Green Kiss API
 *
 * Lean single-file PHP/MySQL backend mirroring the client's db.get/db.set
 * write-through cache shape. All responses are JSON. Writes are POST.
 * Auth is a bearer token: `Authorization: Bearer <token>` header, or a
 * `token` query/body param as a fallback (handy for curl/cron).
 *
 * Actions:
 *   GET   login_options                 - unauthenticated: user names for the login picker
 *   POST  login            {name, pin}  - returns {token, user}
 *   POST  logout                        - invalidates the current token
 *   GET   me                            - current user
 *   GET   kv_all                        - entire kv_store as one object (cold-cache load)
 *   GET   kv_get           ?key=        - single kv value
 *   POST  kv_set           {key,value}  - editor/admin (any role for key "acks")
 *   POST  sop_save         {sop}        - editor/admin; snapshots prior version if changed
 *   GET   revisions_list   ?sop_id=     - list of {id, saved_at, saved_by}
 *   GET   revision_get     ?id=         - single revision snapshot
 *   POST  revision_restore {id}         - editor/admin; snapshots current first
 *   GET   users_list                    - admin
 *   POST  users_upsert     {id?,name,pin?,role} - admin
 *   POST  users_delete     {id}         - admin; refuses to delete the last admin
 *   POST  change_pin       {currentPin,newPin} - any user, own PIN only
 *   POST  upload            (multipart, field "file") - editor/admin
 *
 *   -- Per-record collection writes (safe read-merge-write server side, so
 *      two staff editing different records in the same collection at the
 *      same time never wipe each other out — see collectionUpsert/Delete):
 *   POST  task_save         {task}       - editor/admin; upsert one task by id
 *   POST  task_delete       {id}         - editor/admin
 *   POST  project_save      {project}    - editor/admin; upsert one project by id
 *   POST  project_delete    {id}         - editor/admin
 *   POST  campaign_save     {campaign}   - editor/admin; upsert one campaign by id
 *   POST  campaign_delete   {id}         - editor/admin
 *   POST  content_save      {item}       - editor/admin; upsert one content item by id
 *   POST  content_delete    {id}         - editor/admin
 *   POST  category_save     {category}   - editor/admin; upsert one category by id
 *   POST  category_delete   {id}         - editor/admin
 *   POST  tag_save          {tag}        - editor/admin; upsert one tag by id (#8)
 *   POST  contact_save      {contact}    - editor/admin; upsert one contact by id
 *   POST  contact_delete    {id}         - editor/admin
 *   POST  instance_save     {instance}   - editor/admin; upsert one SOP/Form fill-out instance by id
 *   POST  alert_save        {alert}      - any authenticated user; upsert one alert by id (#9)
 *   POST  alert_delete      {id}         - alert's target, its creator, or admin
 *   POST  template_save     {template}   - editor/admin; upsert one task template by id (#9)
 *   POST  template_delete   {id}         - editor/admin
 *   POST  ack_save          {sopId,userId,at,version} - any user; merges one ack entry
 *
 *   *     backup_run       ?cron_key=   - admin token OR cron_key; also runs lazily on writes
 *   GET   backup_list                   - admin
 *   GET   backup_download  ?file=       - admin; streams the .json.gz
 *   POST  backup_restore   {file}       - admin; snapshots current state first
 *   GET   version_info                  - contents of VERSION file next to this script
 *   POST  admin_deploy                  - admin; triggers a cPanel Git Version Control deploy;
 *                                          snapshots the currently-deployed build first (see #13)
 *   GET   release_list                  - admin; local build snapshots (version, commit, date)
 *   POST  release_rollback {name}       - admin; restores a snapshot's files over the live build,
 *                                          snapshotting the current build first so it's itself undoable
 *   GET   ics_token_get                 - any user; stable per-user token for their calendar feed
 *   GET   calendar_feed    ?token=      - UNAUTHENTICATED; text/calendar feed of the user's dated content
 *   GET   omnisend_campaigns_list       - editor/admin; proxied Omnisend campaign list (key stays server-side)
 *   GET   omnisend_campaign_stats ?id=  - editor/admin; proxied Omnisend stats {opens,clicks,revenue}
 *   GET   shopify_sales                 - editor/admin; today + month-to-date sales summed from Shopify (key server-side)
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    header('Strict-Transport-Security: max-age=63072000; includeSubDomains');
}

// Any exception that escapes a handler below would otherwise print a PHP fatal
// (with the full server path) into a response that still reads as HTTP 200,
// because the Content-Type header above is already sent. The client's writes are
// fire-and-forget, so a body it can't parse looks like success — say plainly
// that the change may not have saved instead.
set_exception_handler(function ($e) {
    error_log('GK API error: ' . $e);
    if (!headers_sent()) http_response_code(500);
    echo json_encode(['error' => 'The server hit an unexpected error and your change may not have saved. Please try again.']);
    exit;
});

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'config.php missing. Copy config.sample.php to config.php and fill in your values.']);
    exit;
}
require_once $configPath;

define('GK_UPLOADS_DIR', defined('UPLOADS_DIR') ? UPLOADS_DIR : __DIR__ . '/uploads');
define('GK_BACKUPS_DIR', defined('BACKUPS_DIR') ? BACKUPS_DIR : __DIR__ . '/backups');
define('GK_RELEASES_DIR', defined('RELEASES_DIR') ? RELEASES_DIR : __DIR__ . '/gk_releases');

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed.']);
    exit;
}

// ─── Table specs — MUST stay above the switch ─────────────────────────
// These are variable ASSIGNMENTS, and PHP does not hoist them the way it
// hoists function declarations. Defined further down the file (next to the
// functions that use them, which is where they read best) they were still
// NULL for the entire request, because the switch below runs long before
// execution ever reaches them — so `global $GK_RECORD_TABLES` inside
// runBackup() saw null, array_keys(null) threw a TypeError, and because
// TypeError extends Error rather than Exception it sailed straight past
// runBackupOrFail's `catch (Exception)` into the generic 500 handler. Net
// effect: every backup failed, and any write that tripped the 6-hourly
// staleness check 500'd with it.
// Anything a request-time function reaches for via `global` belongs HERE.
// scripts/test_record_tables.php asserts that ordering.
//
// define() is a runtime CALL, so it has exactly the same problem: declared at
// line 1833 (beside the backup code it documents) GK_BACKUP_FORMAT did not
// exist while any request ran, and every backup died on "Undefined constant"
// — the same outage as the specs below, from a different symbol.
// Bumped when a backup's shape changes such that an older dump can no longer
// be safely restored; backup_restore refuses anything below it.
define('GK_BACKUP_FORMAT', 2);

// How many images the uploads mirror sends per run, so one cron tick can't hit
// max_execution_time on the first sync of a large library; the rest go next run.
define('GK_UPLOADS_SYNC_CAP', 40);

$GK_CHAT_TABLES = ['chat_channels', 'chat_members', 'chat_messages'];

// Tables that are neither kv nor chat nor per-record, dumped verbatim. tokens is
// deliberately absent: restore clears it so everyone re-logs in against the
// restored user set. login_sessions is the login history behind Admin Panel and
// presence — it was outside every backup until now.
$GK_PLAIN_TABLES = ['login_sessions'];
$GK_RECORD_TABLES = [
    'tasks'      => ['status' => 'VARCHAR(24)', 'due_date' => 'DATE', 'project_id' => 'VARCHAR(24)'],
    'content'    => ['status' => 'VARCHAR(24)', 'publish_date' => 'DATE', 'campaign_id' => 'VARCHAR(24)'],
    'projects'   => ['status' => 'VARCHAR(24)'],
    'campaigns'  => ['status' => 'VARCHAR(24)'],
    'instances'  => ['status' => 'VARCHAR(24)', 'doc_id' => 'VARCHAR(24)'],
    'categories' => [],
    'contacts'   => [],
    'tags'       => [],
    // sops covers Forms too (`kind` is 'sop'|'form'); the library filters on
    // both of these. NOTE: sop_save deliberately does NOT run the #40 conflict
    // check — SOPEditor autosaves every 500ms and a 409 would fight that loop.
    // Give SOPs conflict detection only with save/close-only semantics.
    'sops'       => ['category_id' => 'VARCHAR(24)', 'kind' => 'VARCHAR(16)'],
    'alerts'     => [],
];

$action = $_GET['action'] ?? ($_POST['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'];
$isMultipart = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') !== false;

$body = [];
if ($method === 'POST' && !$isMultipart) {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $body = $decoded;
}

switch ($action) {

    case 'login_options':
        // Unauthenticated on purpose — the login screen needs names before anyone is logged in.
        // Never returns PINs, hashes, or roles.
        $stmt = $pdo->query("SELECT id, name FROM users ORDER BY name ASC");
        respond(200, ['users' => $stmt->fetchAll()]);
        break;

    case 'login':
        if ($method !== 'POST') respond(405, ['error' => 'POST required']);
        $name = trim($body['name'] ?? '');
        $pin = (string)($body['pin'] ?? '');
        if ($name === '' || $pin === '') respond(400, ['error' => 'Name and PIN required']);
        $stmt = $pdo->prepare("SELECT * FROM users WHERE name = ? LIMIT 1");
        $stmt->execute([$name]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($pin, $user['pin_hash'])) {
            respond(401, ['error' => "That PIN doesn't match."]);
        }
        $token = bin2hex(random_bytes(32));
        $pdo->prepare("INSERT INTO tokens (token, user_id, created_at, last_seen) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())")
            ->execute([$token, $user['id']]);
        // Record the sign-in for admin login history (Batch 1).
        ensureLoginSessionsTable($pdo);
        $pdo->prepare("INSERT INTO login_sessions (token, user_id, user_name, login_at, last_seen) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())")
            ->execute([$token, $user['id'], $user['name']]);
        respond(200, ['token' => $token, 'user' => publicUser($user)]);
        break;

    case 'logout':
        $token = bearerToken($body);
        if ($token !== '') {
            ensureLoginSessionsTable($pdo);
            $pdo->prepare("UPDATE login_sessions SET logout_at = UTC_TIMESTAMP(), last_seen = UTC_TIMESTAMP() WHERE token = ? AND logout_at IS NULL")
                ->execute([$token]);
            $pdo->prepare("DELETE FROM tokens WHERE token = ?")->execute([$token]);
        }
        respond(200, ['ok' => true]);
        break;

    case 'me':
        $user = requireAuth($pdo, $body);
        respond(200, ['user' => publicUser($user)]);
        break;

    case 'login_history':
        // Admin-only staff sign-in history (Batch 1). Newest first; the client
        // groups/filters by month. Capped so the payload can't balloon.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        ensureLoginSessionsTable($pdo);
        $stmt = $pdo->query(
            "SELECT id, user_id, user_name, login_at, last_seen, logout_at
             FROM login_sessions ORDER BY login_at DESC LIMIT 2000"
        );
        respond(200, ['sessions' => $stmt->fetchAll()]);
        break;

    case 'presence':
        // Online/offline presence (#49). Any authed user may read it (for the
        // chat window + admin area). Returns the latest last_seen per user from
        // still-open sessions; the client decides "online" via a time window.
        requireAuth($pdo, $body);
        ensureLoginSessionsTable($pdo);
        $stmt = $pdo->query(
            "SELECT user_id, MAX(last_seen) AS last_seen
             FROM login_sessions WHERE logout_at IS NULL
             GROUP BY user_id"
        );
        respond(200, ['presence' => $stmt->fetchAll()]);
        break;

    case 'kv_all':
        requireAuth($pdo, $body);
        $rows = $pdo->query("SELECT k, v FROM kv_store");
        $out = new stdClass();
        foreach ($rows as $r) { $out->{$r['k']} = json_decode($r['v'], true); }
        // Migrated collections come from their own tables (#41), overriding the
        // kv docs of the same name — which are left frozen as the rollback.
        // Serving them here is what keeps the whole client unchanged: it still
        // warms one cache from one payload and never learns where anything is
        // stored. Reverting a collection = removing it from $GK_RECORD_TABLES.
        foreach (array_keys($GK_RECORD_TABLES) as $table) {
            ensureCollectionMigrated($pdo, $table);
            $out->{$table} = recordAll($pdo, $table);
        }
        respond(200, ['data' => $out]);
        break;

    case 'kv_get':
        requireAuth($pdo, $body);
        $key = $_GET['key'] ?? '';
        if ($key === '') respond(400, ['error' => 'Missing key']);
        respond(200, ['value' => kvGet($pdo, $key)]);
        break;

    case 'kv_set':
        $user = requireAuth($pdo, $body);
        $key = $body['key'] ?? '';
        if ($key === '') respond(400, ['error' => 'Missing key']);
        if ($key !== 'acks') requireRole($user, ['editor', 'admin']);
        maybeAutoBackup($pdo);
        kvSet($pdo, $key, array_key_exists('value', $body) ? $body['value'] : null);
        respond(200, ['ok' => true]);
        break;

    case 'sop_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $sop = $body['sop'] ?? null;
        if (!is_array($sop) || empty($sop['id'])) respond(400, ['error' => 'Missing sop']);
        maybeAutoBackup($pdo);
        // Snapshot-then-replace inside the row lock, so a concurrent save can't
        // slip between the revision write and the list write.
        ensureCollectionMigrated($pdo, 'sops');
        // Snapshot-then-replace under a row lock, so a concurrent save can't
        // slip between the revision write and the record write. Same guarantee
        // the kvMutate version gave, now scoped to ONE row instead of the whole
        // library — two people editing different SOPs no longer serialize.
        // No #40 conflict check here on purpose: SOPEditor autosaves every
        // 500ms and a 409 would fight the autosave loop rather than inform
        // anyone (see $GK_RECORD_TABLES).
        // Existence is checked BEFORE opening a transaction, and the lock is
        // only taken when the row actually exists. `SELECT ... FOR UPDATE` on a
        // MISSING row takes a gap lock rather than a row lock (the same trap
        // kvMutate documents), so locking unconditionally made ten people
        // creating ten different new SOPs contend on the same gap — measured as
        // a hang, not a slowdown. A new SOP has no previous version to snapshot,
        // so it needs no lock at all: the upsert is a single statement.
        //
        // The row can still vanish between the check and the lock; that's
        // harmless — FOR UPDATE finds nothing, no revision is written, and the
        // upsert re-creates it.
        $exists = $pdo->prepare("SELECT 1 FROM sops WHERE id = ? LIMIT 1");
        $exists->execute([(string)$sop['id']]);
        if (!$exists->fetch()) {
            recordUpsert($pdo, 'sops', $sop);
        } else {
            $pdo->beginTransaction();
            try {
                $s = $pdo->prepare("SELECT data FROM sops WHERE id = ? FOR UPDATE");
                $s->execute([(string)$sop['id']]);
                $cur = $s->fetch();
                if ($cur) {
                    $old = json_decode($cur['data'], true);
                    if (is_array($old) && sopContentChanged($old, $sop)) {
                        saveRevision($pdo, $sop['id'], $old, $old['updatedBy'] ?? '');
                    }
                }
                recordUpsert($pdo, 'sops', $sop);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }
        }
        respond(200, ['ok' => true, 'sops' => recordAll($pdo, 'sops')]);
        break;

    case 'sop_delete':
        // Deleting used to be a client-side filter of its own cached array,
        // shipped back as a whole-array kv_set — which silently dropped any SOP
        // a coworker had created since that client loaded the page. The filter
        // belongs here, against current data.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        ensureCollectionMigrated($pdo, 'sops');
        $pdo->prepare("DELETE FROM sops WHERE id = ?")->execute([$id]);
        respond(200, ['ok' => true, 'sops' => recordAll($pdo, 'sops')]);
        break;

    case 'doc_item_save':
        // One entry in a single-document list (Image Repository, Tools &
        // Prompts, a Playbook page) — merged server-side against current data.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $key = (string)($body['key'] ?? '');
        $field = docListField($key);
        if ($field === null) respond(400, ['error' => 'Unknown document']);
        $item = $body['item'] ?? null;
        if (!is_array($item) || empty($item['id'])) respond(400, ['error' => 'Missing item']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'doc' => docItemUpsert($pdo, $key, $field, $item)]);
        break;

    case 'doc_item_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $key = (string)($body['key'] ?? '');
        $field = docListField($key);
        if ($field === null) respond(400, ['error' => 'Unknown document']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'doc' => docItemDelete($pdo, $key, $field, $id)]);
        break;

    case 'nav_access_save':
        // One user's sidebar access, merged into the navAccess map — two admins
        // editing different staff no longer overwrite each other.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $targetId = (string)($body['userId'] ?? '');
        if ($targetId === '') respond(400, ['error' => 'Missing userId']);
        $sections = is_array($body['sections'] ?? null) ? array_values($body['sections']) : [];
        maybeAutoBackup($pdo);
        $map = kvMutate($pdo, 'navAccess', function ($map) use ($targetId, $sections) {
            if (!is_array($map)) $map = [];
            $map[$targetId] = $sections;
            return $map;
        });
        respond(200, ['ok' => true, 'navAccess' => $map]);
        break;

    // Tasks live in their own table (#41 step 3) rather than one JSON blob, so
    // a write is a single-row statement instead of a whole-collection
    // read-modify-write under a lock. The RESPONSE shape is unchanged — still
    // the full `tasks` array — so the client needs no change at all.
    case 'task_save':
        // Goes through the SHARED handler, not a bespoke body. This case used to
        // inline its own upsert (from step 3, before the handler understood row
        // tables) and so silently skipped the #40 conflict check that was later
        // added there — leaving the most-edited collection in the app the one
        // collection with no stale-write protection. Caught by driving the real
        // UI against a real server; every unit assertion passed throughout.
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'task', 'tasks');
        break;

    case 'task_delete':
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'tasks');
        break;

    case 'project_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'project', 'projects');
        break;

    case 'project_delete':
        // Cascade: the project's tasks survive as standalone tasks.
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'projects', function ($pdo, $id) {
            ensureTasksMigrated($pdo); // tasks are rows now (#41 step 3)
            return ['tasks' => recordMapAll($pdo, 'tasks', function ($t) use ($id) {
                if (($t['projectId'] ?? '') === $id) $t['projectId'] = '';
                return $t;
            })];
        });
        break;

    case 'campaign_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'campaign', 'campaigns');
        break;

    case 'campaign_delete':
        // Cascade: the campaign's content items survive uncampaigned.
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'campaigns', function ($pdo, $id) {
            ensureCollectionMigrated($pdo, 'content'); // rows now (#41 step 4)
            return ['content' => recordMapAll($pdo, 'content', function ($c) use ($id) {
                if (($c['campaignId'] ?? '') === $id) $c['campaignId'] = '';
                return $c;
            })];
        });
        break;

    case 'content_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'item', 'content');
        break;

    case 'content_delete':
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'content');
        break;

    case 'category_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'category', 'categories');
        break;

    case 'category_delete':
        // Cascade: the category's SOPs become uncategorized rather than deleted.
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'categories', function ($pdo, $id) {
            ensureCollectionMigrated($pdo, 'sops'); // rows now (#41 step 5)
            return ['sops' => recordMapAll($pdo, 'sops', function ($s) use ($id) {
                if (($s['categoryId'] ?? '') === $id) $s['categoryId'] = '';
                return $s;
            })];
        });
        break;

    case 'tag_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'tag', 'tags');
        break;

    case 'contact_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'contact', 'contacts');
        break;

    case 'contact_delete':
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'contacts');
        break;

    case 'instance_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'instance', 'instances');
        break;

    case 'alert_save':
        // Any authenticated user may create — a viewer might need to flag
        // something for a manager even without edit rights.
        $user = requireAuth($pdo, $body);
        $alert = $body['alert'] ?? null;
        if (!is_array($alert) || empty($alert['id'])) respond(400, ['error' => 'Missing alert']);
        maybeAutoBackup($pdo);
        ensureCollectionMigrated($pdo, 'alerts');
        recordUpsert($pdo, 'alerts', $alert);
        respond(200, ['ok' => true, 'alerts' => recordAll($pdo, 'alerts')]);
        break;

    case 'alert_delete':
        // Delete requires being the alert's target, its creator, or an admin
        // — dismissing someone else's flag isn't a role thing, it's an
        // ownership thing.
        $user = requireAuth($pdo, $body);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        // From rows, not the frozen kv doc — reading the old copy would find no
        // target and skip the ownership check entirely.
        ensureCollectionMigrated($pdo, 'alerts');
        $alerts = recordAll($pdo, 'alerts');
        $target = null;
        foreach ($alerts as $a) { if (($a['id'] ?? null) === $id) { $target = $a; break; } }
        if ($target === null) respond(200, ['ok' => true, 'alerts' => $alerts]);
        $isOwner = $target['toUserId'] === $user['id'] || $target['fromUserId'] === $user['id'];
        if (!$isOwner && $user['role'] !== 'admin') respond(403, ['error' => 'Insufficient permissions for this action']);
        maybeAutoBackup($pdo);
        $pdo->prepare("DELETE FROM alerts WHERE id = ?")->execute([$id]);
        respond(200, ['ok' => true, 'alerts' => recordAll($pdo, 'alerts')]);
        break;

    case 'template_save':
        $user = requireAuth($pdo, $body);
        handleCollectionSave($pdo, $body, $user, 'template', 'taskTemplates');
        break;

    case 'template_delete':
        $user = requireAuth($pdo, $body);
        handleCollectionDelete($pdo, $body, $user, 'taskTemplates');
        break;

    case 'ack_save':
        $user = requireAuth($pdo, $body); // any authenticated user may write acks
        // Cast to string: these become array keys below ($acks[$sopId][$userId]),
        // and a non-scalar (e.g. a malformed/array-shaped JSON body) would fatal
        // with "Cannot access offset of type array on array" instead of a clean
        // 400 — verified via `php -r '$a=[]; $a[["x"]]=1;'`.
        $sopId = (string)($body['sopId'] ?? '');
        $userId = (string)($body['userId'] ?? '');
        if ($sopId === '' || $userId === '') respond(400, ['error' => 'Missing sopId/userId']);
        $at = $body['at'] ?? gmdate('c');
        $version = $body['version'] ?? '';
        maybeAutoBackup($pdo);
        $acks = kvMutate($pdo, 'acks', function ($acks) use ($sopId, $userId, $at, $version) {
            if (!is_array($acks)) $acks = [];
            if (!isset($acks[$sopId]) || !is_array($acks[$sopId])) $acks[$sopId] = [];
            $acks[$sopId][$userId] = ['at' => $at, 'version' => $version];
            return $acks;
        });
        respond(200, ['ok' => true, 'acks' => $acks]);
        break;

    case 'announcement_ack_save':
        // Any authenticated user may acknowledge an announcement aimed at them
        // (Batch 2). Merged server-side into announcementAcks so simultaneous
        // acks from different staff never overwrite each other.
        $user = requireAuth($pdo, $body);
        $announcementId = (string)($body['announcementId'] ?? '');
        $userId = (string)($body['userId'] ?? '');
        if ($announcementId === '' || $userId === '') respond(400, ['error' => 'Missing announcementId/userId']);
        $at = $body['at'] ?? gmdate('c');
        maybeAutoBackup($pdo);
        $acks = kvMutate($pdo, 'announcementAcks', function ($acks) use ($announcementId, $userId, $at) {
            if (!is_array($acks)) $acks = [];
            if (!isset($acks[$announcementId]) || !is_array($acks[$announcementId])) $acks[$announcementId] = [];
            $acks[$announcementId][$userId] = ['at' => $at];
            return $acks;
        });
        respond(200, ['ok' => true, 'acks' => $acks]);
        break;

    case 'callback_ack_save':
        // Any authenticated user may acknowledge a callback aimed at them
        // (Batch 4). Merged server-side into callbackAcks, same as announcements.
        $user = requireAuth($pdo, $body);
        $callbackId = (string)($body['callbackId'] ?? '');
        $userId = (string)($body['userId'] ?? '');
        if ($callbackId === '' || $userId === '') respond(400, ['error' => 'Missing callbackId/userId']);
        $at = $body['at'] ?? gmdate('c');
        maybeAutoBackup($pdo);
        $acks = kvMutate($pdo, 'callbackAcks', function ($acks) use ($callbackId, $userId, $at) {
            if (!is_array($acks)) $acks = [];
            if (!isset($acks[$callbackId]) || !is_array($acks[$callbackId])) $acks[$callbackId] = [];
            $acks[$callbackId][$userId] = ['at' => $at];
            return $acks;
        });
        respond(200, ['ok' => true, 'acks' => $acks]);
        break;

    // ─── Staff chat (Phase 1) ─────────────────────────────────────────
    case 'chat_bootstrap':
        // Channels the user can see, with unread counts + last-message preview.
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $me = $user['id'];
        $stmt = $pdo->prepare(
            "SELECT c.* FROM chat_channels c
             WHERE c.archived = 0 AND (
               c.visibility = 'public'
               OR EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = ?)
             ) ORDER BY c.kind, c.name");
        $stmt->execute([$me]);
        $out = [];
        foreach ($stmt->fetchAll() as $c) {
            $lst = $pdo->prepare("SELECT id, user_id, body, created_at FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1");
            $lst->execute([$c['id']]);
            $last = $lst->fetch();
            $lastId = $last ? (int)$last['id'] : 0;
            // Unread = everything since you last read (no history catch-up).
            // A member row is created lazily on first read (chat_mark_read).
            $mst = $pdo->prepare("SELECT last_read_msg_id FROM chat_members WHERE channel_id = ? AND user_id = ? LIMIT 1");
            $mst->execute([$c['id'], $me]);
            $mrow = $mst->fetch();
            $lastRead = $mrow ? (int)$mrow['last_read_msg_id'] : 0;
            $ust = $pdo->prepare("SELECT COUNT(*) FROM chat_messages WHERE channel_id = ? AND id > ? AND user_id <> ? AND deleted_at IS NULL");
            $ust->execute([$c['id'], $lastRead, $me]);
            $mem = $pdo->prepare("SELECT user_id FROM chat_members WHERE channel_id = ?");
            $mem->execute([$c['id']]);
            $out[] = [
                'id' => $c['id'], 'name' => $c['name'], 'kind' => $c['kind'], 'visibility' => $c['visibility'],
                'createdBy' => $c['created_by'], 'lastMsgId' => $lastId, 'unread' => (int)$ust->fetchColumn(),
                'memberIds' => array_column($mem->fetchAll(), 'user_id'),
                'lastMessage' => $last ? ['userId' => $last['user_id'], 'body' => $last['body'], 'createdAt' => $last['created_at']] : null,
            ];
        }
        respond(200, ['channels' => $out]);
        break;

    case 'chat_channel_create':
        // Admin-managed channels (Phase 1). dm/group creation lands in Phase 2.
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $kind = in_array(($body['kind'] ?? 'channel'), ['channel', 'dm', 'group'], true) ? $body['kind'] : 'channel';
        if ($kind === 'channel') requireRole($user, ['admin']);
        $vis = ($body['visibility'] ?? 'public') === 'private' ? 'private' : 'public';
        $name = trim($body['name'] ?? '');
        if ($kind === 'channel' && $name === '') respond(400, ['error' => 'Channel name required']);
        $id = 'ch_' . bin2hex(random_bytes(5));
        $pdo->prepare("INSERT INTO chat_channels (id, name, kind, visibility, created_by) VALUES (?, ?, ?, ?, ?)")
            ->execute([$id, $name, $kind, $vis, $user['id']]);
        $memberIds = is_array($body['memberIds'] ?? null) ? $body['memberIds'] : [];
        foreach (array_unique(array_merge([$user['id']], $memberIds)) as $mid) {
            $pdo->prepare("INSERT IGNORE INTO chat_members (channel_id, user_id, last_read_msg_id) VALUES (?, ?, 0)")->execute([$id, (string)$mid]);
        }
        respond(200, ['id' => $id]);
        break;

    case 'chat_dm_open':
        // Find-or-create a 1:1 DM with another user (Phase 2) so the same pair
        // never ends up with duplicate threads.
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $other = (string)($body['userId'] ?? '');
        if ($other === '' || $other === $user['id']) respond(400, ['error' => 'Pick another person']);
        $stmt = $pdo->prepare(
            "SELECT c.id FROM chat_channels c
             WHERE c.kind = 'dm' AND c.archived = 0
               AND (SELECT COUNT(*) FROM chat_members m WHERE m.channel_id = c.id) = 2
               AND EXISTS (SELECT 1 FROM chat_members m1 WHERE m1.channel_id = c.id AND m1.user_id = ?)
               AND EXISTS (SELECT 1 FROM chat_members m2 WHERE m2.channel_id = c.id AND m2.user_id = ?)
             LIMIT 1");
        $stmt->execute([$user['id'], $other]);
        $ex = $stmt->fetch();
        if ($ex) { respond(200, ['id' => $ex['id']]); }
        $id = 'ch_' . bin2hex(random_bytes(5));
        $pdo->prepare("INSERT INTO chat_channels (id, name, kind, visibility, created_by) VALUES (?, '', 'dm', 'private', ?)")->execute([$id, $user['id']]);
        foreach ([$user['id'], $other] as $mid) {
            $pdo->prepare("INSERT IGNORE INTO chat_members (channel_id, user_id, last_read_msg_id) VALUES (?, ?, 0)")->execute([$id, $mid]);
        }
        respond(200, ['id' => $id]);
        break;

    case 'chat_alerts':
        // Unread messages worth a toast (Phase 3): anything in a DM/group, plus
        // @mentions of me in any channel. Client passes a cursor so each one
        // toasts once.
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $me = $user['id'];
        $since = (int)($_GET['sinceId'] ?? 0);
        $like = '%(user:' . $me . ')%';
        $stmt = $pdo->prepare(
            "SELECT msg.id, msg.channel_id, msg.user_id, msg.body, c.kind AS channel_kind, c.name AS channel_name
             FROM chat_messages msg
             JOIN chat_channels c ON c.id = msg.channel_id AND c.archived = 0
             JOIN chat_members mem ON mem.channel_id = msg.channel_id AND mem.user_id = ?
             WHERE msg.deleted_at IS NULL AND msg.user_id <> ? AND msg.id > ? AND msg.id > mem.last_read_msg_id
               AND (c.kind IN ('dm','group') OR msg.body LIKE ?)
             ORDER BY msg.id DESC LIMIT 10");
        $stmt->execute([$me, $me, $since, $like]);
        respond(200, ['messages' => array_reverse($stmt->fetchAll())]);
        break;

    case 'chat_messages':
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $channelId = (string)($_GET['channelId'] ?? ($body['channelId'] ?? ''));
        if (!chatCanSee($pdo, $channelId, $user['id'])) respond(403, ['error' => 'No access to this channel']);
        $beforeId = (int)($_GET['beforeId'] ?? 0);
        if ($beforeId > 0) {
            $stmt = $pdo->prepare("SELECT id, user_id, body, created_at, edited_at, deleted_at FROM chat_messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT 50");
            $stmt->execute([$channelId, $beforeId]);
        } else {
            $stmt = $pdo->prepare("SELECT id, user_id, body, created_at, edited_at, deleted_at FROM chat_messages WHERE channel_id = ? ORDER BY id DESC LIMIT 50");
            $stmt->execute([$channelId]);
        }
        respond(200, ['messages' => array_reverse($stmt->fetchAll())]);
        break;

    case 'chat_send':
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $channelId = (string)($body['channelId'] ?? '');
        $text = trim((string)($body['body'] ?? ''));
        if ($channelId === '' || $text === '') respond(400, ['error' => 'Missing channel or body']);
        if (!chatCanSee($pdo, $channelId, $user['id'])) respond(403, ['error' => 'No access to this channel']);
        if (mb_strlen($text) > 8000) $text = mb_substr($text, 0, 8000);
        $pdo->prepare("INSERT INTO chat_messages (channel_id, user_id, body) VALUES (?, ?, ?)")->execute([$channelId, $user['id'], $text]);
        $mid = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO chat_members (channel_id, user_id, last_read_msg_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_read_msg_id = GREATEST(last_read_msg_id, VALUES(last_read_msg_id))")
            ->execute([$channelId, $user['id'], $mid]);
        respond(200, ['message' => ['id' => $mid, 'user_id' => $user['id'], 'body' => $text, 'created_at' => gmdate('Y-m-d H:i:s')]]);
        break;

    case 'chat_edit':
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $id = (int)($body['id'] ?? 0);
        $text = trim((string)($body['body'] ?? ''));
        if ($id <= 0 || $text === '') respond(400, ['error' => 'Missing id/body']);
        if (mb_strlen($text) > 8000) $text = mb_substr($text, 0, 8000);
        $pdo->prepare("UPDATE chat_messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
            ->execute([$text, $id, $user['id']]);
        respond(200, ['ok' => true]);
        break;

    case 'chat_delete':
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $id = (int)($body['id'] ?? 0);
        if ($id <= 0) respond(400, ['error' => 'Missing id']);
        $pdo->prepare("UPDATE chat_messages SET deleted_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?")->execute([$id, $user['id']]);
        respond(200, ['ok' => true]);
        break;

    case 'chat_channel_archive':
        // Admins archive channels; DM/group members can archive their own.
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $channelId = (string)($body['channelId'] ?? '');
        $cs = $pdo->prepare("SELECT kind FROM chat_channels WHERE id = ? LIMIT 1");
        $cs->execute([$channelId]);
        $crow = $cs->fetch();
        if (!$crow) respond(404, ['error' => 'Channel not found']);
        if ($crow['kind'] === 'channel') requireRole($user, ['admin']);
        elseif (!chatCanSee($pdo, $channelId, $user['id'])) respond(403, ['error' => 'No access']);
        $pdo->prepare("UPDATE chat_channels SET archived = 1 WHERE id = ?")->execute([$channelId]);
        respond(200, ['ok' => true]);
        break;

    case 'chat_mark_read':
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $channelId = (string)($body['channelId'] ?? '');
        if ($channelId === '') respond(400, ['error' => 'Missing channel']);
        $upTo = (int)($body['upToMsgId'] ?? 0);
        if ($upTo <= 0) { $s = $pdo->prepare("SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE channel_id = ?"); $s->execute([$channelId]); $upTo = (int)$s->fetchColumn(); }
        $pdo->prepare("INSERT INTO chat_members (channel_id, user_id, last_read_msg_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_read_msg_id = GREATEST(last_read_msg_id, VALUES(last_read_msg_id))")
            ->execute([$channelId, $user['id'], $upTo]);
        respond(200, ['ok' => true, 'lastRead' => $upTo]);
        break;

    case 'chat_poll':
        // Cheap short-poll: per-channel unread + newest id, plus new messages
        // for the currently-open channel (since a client cursor).
        $user = requireAuth($pdo, $body);
        ensureChatTables($pdo);
        $me = $user['id'];
        $stmt = $pdo->prepare(
            "SELECT c.id,
               (SELECT COALESCE(MAX(mm.id),0) FROM chat_messages mm WHERE mm.channel_id = c.id AND mm.deleted_at IS NULL) AS last_msg_id,
               (SELECT COUNT(*) FROM chat_messages um WHERE um.channel_id = c.id AND um.user_id <> ? AND um.deleted_at IS NULL
                  AND um.id > (SELECT COALESCE(m.last_read_msg_id,0) FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = ?)) AS unread
             FROM chat_channels c
             WHERE c.archived = 0 AND (c.visibility = 'public' OR EXISTS (SELECT 1 FROM chat_members mx WHERE mx.channel_id = c.id AND mx.user_id = ?))");
        $stmt->execute([$me, $me, $me]);
        $channels = [];
        foreach ($stmt->fetchAll() as $r) $channels[] = ['id' => $r['id'], 'lastMsgId' => (int)$r['last_msg_id'], 'unread' => (int)$r['unread']];
        $newMessages = [];
        $openChannel = (string)($_GET['openChannelId'] ?? '');
        $sinceId = (int)($_GET['sinceId'] ?? 0);
        if ($openChannel !== '' && chatCanSee($pdo, $openChannel, $me)) {
            $ms = $pdo->prepare("SELECT id, user_id, body, created_at, edited_at, deleted_at FROM chat_messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT 100");
            $ms->execute([$openChannel, $sinceId]);
            $newMessages = $ms->fetchAll();
        }
        respond(200, ['channels' => $channels, 'newMessages' => $newMessages]);
        break;

    case 'revisions_list':
        requireAuth($pdo, $body);
        $sopId = $_GET['sop_id'] ?? '';
        if ($sopId === '') respond(400, ['error' => 'Missing sop_id']);
        $stmt = $pdo->prepare("SELECT id, saved_at, saved_by FROM revisions WHERE sop_id = ? ORDER BY saved_at DESC, id DESC");
        $stmt->execute([$sopId]);
        respond(200, ['revisions' => $stmt->fetchAll()]);
        break;

    case 'revision_get':
        requireAuth($pdo, $body);
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) respond(400, ['error' => 'Missing id']);
        $stmt = $pdo->prepare("SELECT * FROM revisions WHERE id = ? LIMIT 1");
        $stmt->execute([$id]);
        $rev = $stmt->fetch();
        if (!$rev) respond(404, ['error' => 'Not found']);
        respond(200, ['revision' => [
            'id' => (int)$rev['id'], 'sopId' => $rev['sop_id'], 'savedAt' => $rev['saved_at'],
            'savedBy' => $rev['saved_by'], 'snapshot' => json_decode($rev['snapshot'], true),
        ]]);
        break;

    case 'revision_restore':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = (int)($body['id'] ?? 0);
        if (!$id) respond(400, ['error' => 'Missing id']);
        $stmt = $pdo->prepare("SELECT * FROM revisions WHERE id = ? LIMIT 1");
        $stmt->execute([$id]);
        $rev = $stmt->fetch();
        if (!$rev) respond(404, ['error' => 'Not found']);
        maybeAutoBackup($pdo);
        $snapshot = json_decode($rev['snapshot'], true);
        $restored = null;
        ensureCollectionMigrated($pdo, 'sops');
        // Snapshot the current version before overwriting it, under the same
        // row lock, so the restore is itself undoable and a concurrent save
        // can't interleave. Missing SOP: leave everything alone and report
        // after the transaction — respond() exits, and exiting from inside an
        // open transaction is not worth relying on.
        // Restoring only ever targets an EXISTING sop, so FOR UPDATE here takes
        // a real row lock — but check first anyway, so a restore aimed at a
        // deleted SOP doesn't open a transaction just to gap-lock and bail.
        $exists = $pdo->prepare("SELECT 1 FROM sops WHERE id = ? LIMIT 1");
        $exists->execute([(string)$rev['sop_id']]);
        if (!$exists->fetch()) respond(404, ['error' => 'SOP no longer exists']);
        $pdo->beginTransaction();
        try {
            $s = $pdo->prepare("SELECT data FROM sops WHERE id = ? FOR UPDATE");
            $s->execute([(string)$rev['sop_id']]);
            $cur = $s->fetch();
            if ($cur) {
                $old = json_decode($cur['data'], true);
                if (is_array($old)) {
                    saveRevision($pdo, $rev['sop_id'], $old, $old['updatedBy'] ?? '');
                    $restored = array_merge($old, $snapshot, [
                        'id' => $rev['sop_id'],
                        'updatedAt' => gmdate('c'),
                        'updatedBy' => $user['name'],
                    ]);
                    recordUpsert($pdo, 'sops', $restored);
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        if ($restored === null) respond(404, ['error' => 'SOP no longer exists']);
        respond(200, ['ok' => true, 'sop' => $restored]);
        break;

    case 'users_list':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $stmt = $pdo->query("SELECT id, name, role, created_at FROM users ORDER BY name ASC");
        respond(200, ['users' => $stmt->fetchAll()]);
        break;

    case 'users_upsert':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $id = trim($body['id'] ?? '');
        $name = trim($body['name'] ?? '');
        $pin = (string)($body['pin'] ?? '');
        $role = in_array($body['role'] ?? '', ['admin', 'editor', 'viewer'], true) ? $body['role'] : 'viewer';
        if ($name === '') respond(400, ['error' => 'Name required']);
        maybeAutoBackup($pdo);
        if ($id !== '') {
            if ($pin !== '') {
                $hash = password_hash($pin, PASSWORD_DEFAULT);
                $pdo->prepare("UPDATE users SET name = ?, pin_hash = ?, role = ? WHERE id = ?")
                    ->execute([$name, $hash, $role, $id]);
            } else {
                $pdo->prepare("UPDATE users SET name = ?, role = ? WHERE id = ?")
                    ->execute([$name, $role, $id]);
            }
        } else {
            if ($pin === '') respond(400, ['error' => 'PIN required for new users']);
            $id = 'u_' . bin2hex(random_bytes(6));
            $hash = password_hash($pin, PASSWORD_DEFAULT);
            $pdo->prepare("INSERT INTO users (id, name, pin_hash, role, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())")
                ->execute([$id, $name, $hash, $role]);
        }
        respond(200, ['ok' => true, 'id' => $id]);
        break;

    case 'users_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        $stmt = $pdo->prepare("SELECT role FROM users WHERE id = ?");
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) respond(404, ['error' => 'Not found']);
        if ($target['role'] === 'admin') {
            $count = (int)$pdo->query("SELECT COUNT(*) c FROM users WHERE role = 'admin'")->fetch()['c'];
            if ($count <= 1) respond(400, ['error' => "Can't delete the last admin."]);
        }
        maybeAutoBackup($pdo);
        $pdo->prepare("DELETE FROM users WHERE id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM tokens WHERE user_id = ?")->execute([$id]);
        respond(200, ['ok' => true]);
        break;

    case 'change_pin':
        $user = requireAuth($pdo, $body);
        $current = (string)($body['currentPin'] ?? '');
        $next = (string)($body['newPin'] ?? '');
        if ($next === '') respond(400, ['error' => 'New PIN required']);
        $stmt = $pdo->prepare("SELECT pin_hash FROM users WHERE id = ?");
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($current, $row['pin_hash'])) {
            respond(401, ['error' => "Current PIN doesn't match."]);
        }
        maybeAutoBackup($pdo);
        $hash = password_hash($next, PASSWORD_DEFAULT);
        $pdo->prepare("UPDATE users SET pin_hash = ? WHERE id = ?")->execute([$hash, $user['id']]);
        respond(200, ['ok' => true]);
        break;

    case 'upload':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        if ($method !== 'POST') respond(405, ['error' => 'POST required']);
        if (!isset($_FILES['file'])) respond(400, ['error' => 'No file']);
        $file = $_FILES['file'];
        if (($file['error'] ?? 1) !== UPLOAD_ERR_OK) respond(400, ['error' => 'Upload failed']);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realType = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        if (!isset($allowed[$realType])) respond(400, ['error' => 'Invalid file type. Only JPEG, PNG, WEBP, GIF allowed.']);
        if ($file['size'] > 8 * 1024 * 1024) respond(400, ['error' => 'File too large (8MB max)']);
        maybeAutoBackup($pdo);
        $monthFolder = gmdate('Ym');
        $dir = ensureUploadsDir($monthFolder);
        $name = bin2hex(random_bytes(8)) . '.' . $allowed[$realType];
        move_uploaded_file($file['tmp_name'], "$dir/$name");
        respond(200, ['url' => "uploads/$monthFolder/$name"]);
        break;

    case 'backup_run':
        $cronKey = (string)($_GET['cron_key'] ?? ($body['cron_key'] ?? ''));
        switch (cronKeyVerdict($cronKey, defined('CRON_KEY') ? CRON_KEY : null)) {
            case 'accept':
                break; // cron path — no user token needed
            case 'no_key':
                $user = requireAuth($pdo, $body);
                requireRole($user, ['admin']);
                break;
            default:
                // A cron_key WAS supplied and rejected. Saying so beats falling
                // through to a bare "login required", which is what every
                // misconfigured cron used to report — identical message for a
                // typo, a stray space, an unencoded character and an untouched
                // PASTE_ placeholder, with nothing to act on. This reveals only
                // that the supplied key was rejected, which the caller already
                // knows from being denied; the key itself is never echoed.
                respond(403, ['error' => cronKeyHint(defined('CRON_KEY') ? CRON_KEY : null)]);
        }
        $file = runBackupOrFail($pdo);
        // Off-site copy rides the explicit backup path only (this action = the
        // daily cron and the admin's "Back up now" button), never the lazy
        // write-triggered one — see offsiteSync's header comment.
        // Uploads ride the same explicit path as the DB copy (cron + the admin
        // button), never maybeAutoBackup — an image upload inside a staff save
        // would add seconds to it.
        respond(200, ['ok' => true, 'file' => $file, 'offsite' => offsiteSync($pdo, $file), 'uploads' => uploadsSync($pdo)]);
        break;

    case 'backup_list':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        // Off-site status ships with the list so the Backups tile can show a
        // dead uploader without the admin having to go looking for it.
        respond(200, [
            'backups' => listBackups(),
            'offsite' => offsiteConfigured()
                ? (kvGet($pdo, 'backupOffsite') ?: ['configured' => true, 'ok' => null, 'error' => 'No off-site copy has run yet.'])
                : ['configured' => false],
            // Same reasoning as offsite: a mirror that quietly stopped looks
            // exactly like one that finished, so its status ships with the list.
            'uploads' => offsiteConfigured()
                ? (kvGet($pdo, 'backupUploads') ?: ['configured' => true, 'ok' => null, 'error' => 'No uploads mirror has run yet.'])
                : ['configured' => false],
        ]);
        break;

    case 'backup_download':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $name = basename((string)($_GET['file'] ?? ''));
        if (!preg_match('/^gk_[0-9_]+\.json\.gz$/', $name)) respond(400, ['error' => 'Invalid filename']);
        $path = ensureBackupsDir() . '/' . $name;
        if (!file_exists($path)) respond(404, ['error' => 'Not found']);
        header('Content-Type: application/gzip');
        header('Content-Disposition: attachment; filename="' . $name . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);
        exit;

    case 'backup_restore':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $name = basename((string)($body['file'] ?? ''));
        if (!preg_match('/^gk_[0-9_]+\.json\.gz$/', $name)) respond(400, ['error' => 'Invalid filename']);
        $path = ensureBackupsDir() . '/' . $name;
        if (!file_exists($path)) respond(404, ['error' => 'Not found']);
        // Read the backup we're restoring BEFORE taking the safety snapshot —
        // belt and braces alongside runBackup's no-overwrite guard, so the
        // snapshot can never influence what gets restored.
        $raw = @gzdecode(file_get_contents($path));
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($data)) respond(500, ['error' => 'Backup file is corrupt or unreadable']);
        // Second line of defence behind the purge in ensureBackupsDir: an
        // off-site copy pulled back from B2 and dropped in by hand never passed
        // through that purge, and restoring it would delete every table this
        // dump predates rather than roll it back.
        if ((int)($data['format'] ?? 0) < GK_BACKUP_FORMAT) {
            respond(400, ['error' => 'This backup predates the current data format and can no longer be restored — it would delete data it never captured.']);
        }
        // Safety snapshot of current state before we overwrite anything.
        runBackupOrFail($pdo);
        restoreFromBackupData($pdo, $data);
        respond(200, ['ok' => true]);
        break;

    case 'version_info':
        $path = __DIR__ . '/VERSION';
        if (is_file($path)) {
            $v = json_decode(file_get_contents($path), true);
            respond(200, is_array($v) ? $v : ['version' => 'dev']);
        }
        respond(200, ['version' => 'dev']);
        break;

    case 'admin_deploy':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        if (
            !defined('CPANEL_HOST') || !defined('CPANEL_USERNAME') || !defined('CPANEL_REPO_PATH') ||
            !defined('CPANEL_API_TOKEN') || CPANEL_API_TOKEN === '' || strpos(CPANEL_API_TOKEN, 'PASTE_') === 0
        ) {
            respond(400, ['error' => 'Deploy is not configured yet. Add CPANEL_HOST, CPANEL_USERNAME, CPANEL_API_TOKEN, and CPANEL_REPO_PATH to config.php — see DEPLOY.md.']);
        }
        // This is a "we're about to change what code is live" moment — take a
        // fresh data backup regardless of the normal 24h-lazy threshold...
        runBackupOrFail($pdo);
        // ...and a code snapshot of what's CURRENTLY deployed, before we
        // overwrite it (see #13 rollback). Best-effort: if index.html isn't
        // there yet (first-ever deploy), this is a silent no-op.
        snapshotCurrentBuild();

        $authHeader = 'Authorization: cpanel ' . CPANEL_USERNAME . ':' . CPANEL_API_TOKEN;
        $host = 'https://' . CPANEL_HOST . ':2083';

        // Step 1: bring the local checkout up to date with GitHub before
        // deploying. VersionControl::update needs BOTH repository_root AND
        // branch — without branch it's a settings no-op that reports success
        // while pulling nothing (bit us in v0.1.3→v0.1.4). Still best-effort:
        // if it fails, we proceed to deploy whatever commit is checked out,
        // which is a safe no-op rather than a destructive failure.
        $branch = defined('CPANEL_REPO_BRANCH') ? CPANEL_REPO_BRANCH : 'release';
        $pullResult = cpanelApiCall($host . '/execute/VersionControl/update', ['repository_root' => CPANEL_REPO_PATH, 'branch' => $branch], $authHeader);

        // Step 2: deploy — runs the .cpanel.yml task, copying the checked-out
        // branch's files into the live document root.
        $deployResult = cpanelApiCall($host . '/execute/VersionControlDeployment/create', ['repository_root' => CPANEL_REPO_PATH], $authHeader);

        $deployStatus = $deployResult['data']['result']['status'] ?? null;
        $deployOk = $deployResult['httpCode'] === 200 && $deployResult['curlError'] === null
            && ($deployStatus === null || (int)$deployStatus === 1);
        $pullStatus = $pullResult['data']['result']['status'] ?? null;
        $pullOk = $pullResult['httpCode'] === 200 && $pullResult['curlError'] === null
            && ($pullStatus === null || (int)$pullStatus === 1);

        // Human-readable step-by-step notes so a failure is debuggable from
        // the Admin Panel alone, without needing to tail a PHP error log.
        $notes = [];
        $notes[] = $pullOk
            ? 'Remote-update pull: ok (HTTP ' . $pullResult['httpCode'] . ').'
            : 'Remote-update pull: failed (' . ($pullResult['curlError'] ?: ('HTTP ' . $pullResult['httpCode'] . (isset($pullResult['data']['result']['errors']) ? ' — ' . json_encode($pullResult['data']['result']['errors']) : ($pullResult['rawExcerpt'] ? ' — ' . $pullResult['rawExcerpt'] : '')))) . ') — this step is best-effort; deploy proceeds with whatever commit is already checked out.';
        $notes[] = $deployOk
            ? 'Deploy: triggered successfully.'
            : 'Deploy: failed (' . ($deployResult['curlError'] ?: ('HTTP ' . $deployResult['httpCode'] . (isset($deployResult['data']['result']['errors']) ? ' — ' . json_encode($deployResult['data']['result']['errors']) : ($deployResult['rawExcerpt'] ? ' — ' . $deployResult['rawExcerpt'] : '')))) . ').';

        if ($deployOk) {
            kvSet($pdo, 'lastDeploy', ['deployedAt' => gmdate('c'), 'deployedBy' => $user['name']]);
        }

        respond($deployOk ? 200 : 500, [
            'ok' => $deployOk,
            'notes' => $notes,
            'error' => $deployOk ? null : implode(' ', $notes),
            'pull' => $pullResult,
            'deploy' => $deployResult,
        ]);
        break;

    case 'release_list':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        respond(200, ['releases' => listReleases()]);
        break;

    case 'release_rollback':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        $name = basename((string)($body['name'] ?? ''));
        if ($name === '') respond(400, ['error' => 'Missing name']);
        maybeAutoBackup($pdo);
        // Snapshot the current (about-to-be-replaced) build first, so this
        // rollback is itself rollback-able — same courtesy a normal deploy gets.
        snapshotCurrentBuild();
        try {
            rollbackToRelease($name);
        } catch (Exception $e) {
            respond(400, ['error' => $e->getMessage()]);
        }
        $target = null;
        foreach (listReleases() as $r) { if ($r['name'] === $name) { $target = $r; break; } }
        $lastDeploy = [
            'deployedAt' => gmdate('c'), 'deployedBy' => $user['name'],
            'rollback' => true, 'version' => $target['version'] ?? null,
        ];
        kvSet($pdo, 'lastDeploy', $lastDeploy);
        respond(200, ['ok' => true, 'lastDeploy' => $lastDeploy]);
        break;

    case 'ics_token_get':
        // Any authenticated user — a stable per-user token for their Google
        // Calendar subscribe feed. Stored in one kv map {userId: token}.
        $user = requireAuth($pdo, $body);
        // Under the row lock: two tabs asking at once would otherwise each mint
        // a token and the second write would drop the first user's entry.
        $tokens = kvMutate($pdo, 'icsTokens', function ($tokens) use ($user) {
            if (!is_array($tokens)) $tokens = [];
            if (empty($tokens[$user['id']])) $tokens[$user['id']] = bin2hex(random_bytes(20));
            return $tokens;
        });
        respond(200, ['token' => $tokens[$user['id']]]);
        break;

    case 'calendar_feed':
        // UNAUTHENTICATED on purpose — Google fetches this URL with no headers.
        // The random token IS the credential; it maps back to one user.
        $token = (string)($_GET['token'] ?? '');
        $tokens = kvGet($pdo, 'icsTokens') ?: [];
        $userId = array_search($token, $tokens, true);
        if ($token === '' || $userId === false) {
            http_response_code(404);
            header('Content-Type: text/plain');
            echo 'Invalid calendar token';
            exit;
        }
        $items = kvGet($pdo, 'content') ?: [];
        $campaigns = kvGet($pdo, 'campaigns') ?: [];
        $campStaff = [];
        foreach ($campaigns as $c) { $campStaff[$c['id'] ?? ''] = $c['assigneeIds'] ?? []; }
        $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Green Kiss//Content Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Green Kiss Content'];
        $stamp = gmdate('Ymd\THis\Z');
        foreach ($items as $it) {
            $date = $it['publishDate'] ?? '';
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) continue;
            $itAssignees = $it['assigneeIds'] ?? [];
            $mine = in_array($userId, is_array($itAssignees) ? $itAssignees : [], true)
                || (($it['assigneeId'] ?? '') === $userId)
                || in_array($userId, $campStaff[$it['campaignId'] ?? ''] ?? [], true);
            if (!$mine) continue;
            $dt = str_replace('-', '', $date);
            $dtEnd = str_replace('-', '', gmdate('Y-m-d', strtotime($date . ' +1 day')));
            $summary = icsEscape(($it['title'] ?? 'Untitled') . ' — ' . ($it['channel'] ?? ''));
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:gk-' . ($it['id'] ?? uniqid()) . '@thegreenkiss';
            $lines[] = 'DTSTAMP:' . $stamp;
            $lines[] = 'DTSTART;VALUE=DATE:' . $dt;
            $lines[] = 'DTEND;VALUE=DATE:' . $dtEnd;
            $lines[] = 'SUMMARY:' . $summary;
            if (!empty($it['body'])) $lines[] = 'DESCRIPTION:' . icsEscape($it['body']);
            $lines[] = 'END:VEVENT';
        }
        // Multi-day campaign bands — one all-day span per campaign the user is staffed on.
        foreach ($campaigns as $c) {
            if (!in_array($userId, $c['assigneeIds'] ?? [], true)) continue;
            $cs = $c['startDate'] ?? ''; $ce = $c['endDate'] ?? '';
            if ($cs === '') $cs = $ce;
            if ($ce === '') $ce = $cs;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $cs)) continue;
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:gk-camp-' . ($c['id'] ?? uniqid()) . '@thegreenkiss';
            $lines[] = 'DTSTAMP:' . $stamp;
            $lines[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $cs);
            $lines[] = 'DTEND;VALUE=DATE:' . str_replace('-', '', gmdate('Y-m-d', strtotime($ce . ' +1 day')));
            $lines[] = 'SUMMARY:' . icsEscape(($c['name'] ?? 'Campaign') . ' (campaign)');
            if (!empty($c['description'])) $lines[] = 'DESCRIPTION:' . icsEscape($c['description']);
            $lines[] = 'END:VEVENT';
        }
        // Tasks the user opted onto the calendar (#53) — per-task flag OR the
        // task's project flag; only tasks assigned to this user, keyed on due
        // date (spanning from start date when one is set).
        $tasks = kvGet($pdo, 'tasks') ?: [];
        $projects = kvGet($pdo, 'projects') ?: [];
        $projCal = [];
        foreach ($projects as $p) { $projCal[$p['id'] ?? ''] = !empty($p['includeTasksOnCalendar']); }
        foreach ($tasks as $t) {
            if (!empty($t['archived'])) continue;
            $onCal = !empty($t['onCalendar']) || ($projCal[$t['projectId'] ?? ''] ?? false);
            if (!$onCal) continue;
            $tAssignees = $t['assigneeIds'] ?? [];
            $tMine = in_array($userId, is_array($tAssignees) ? $tAssignees : [], true)
                || ($t['assignedTo'] ?? '') === $userId;
            if (!$tMine) continue;
            $due = $t['dueDate'] ?? '';
            $startD = $t['startDate'] ?? '';
            $anchor = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) ? $due : $startD;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $anchor)) continue;
            $spanStart = (preg_match('/^\d{4}-\d{2}-\d{2}$/', $startD) && $startD <= $anchor) ? $startD : $anchor;
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:gk-task-' . ($t['id'] ?? uniqid()) . '@thegreenkiss';
            $lines[] = 'DTSTAMP:' . $stamp;
            $lines[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $spanStart);
            $lines[] = 'DTEND;VALUE=DATE:' . str_replace('-', '', gmdate('Y-m-d', strtotime($anchor . ' +1 day')));
            $lines[] = 'SUMMARY:' . icsEscape(($t['title'] ?? 'Task') . ' (task)');
            if (!empty($t['description'])) $lines[] = 'DESCRIPTION:' . icsEscape($t['description']);
            $lines[] = 'END:VEVENT';
        }
        $lines[] = 'END:VCALENDAR';
        header('Content-Type: text/calendar; charset=utf-8');
        header('Content-Disposition: inline; filename="greenkiss.ics"');
        echo implode("\r\n", $lines);
        exit;

    case 'omnisend_campaigns_list':
        // Field shape confirmed 2026-07-21 against a live response (see
        // omnisendApiCall's header comment for the auth fix that unblocked
        // this). {id,name,status,type,channel,sendingSettings{scheduledAt},
        // createdAt,startedAt?,endedAt?} — startedAt/endedAt only exist once
        // a send has actually kicked off. Drafts ARE included by default,
        // no status filter needed. Limited to email since that's the only
        // channel content items link to.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $res = omnisendApiCall('/campaigns?limit=100&channel=email');
        if (!$res['ok']) respond(502, ['error' => $res['error']]);
        $out = [];
        foreach (($res['data']['campaigns'] ?? []) as $c) {
            $date = $c['startedAt'] ?? ($c['sendingSettings']['scheduledAt'] ?? ($c['createdAt'] ?? ''));
            $out[] = [
                'id' => $c['id'] ?? '',
                'name' => $c['name'] ?? 'Untitled',
                'status' => $c['status'] ?? '',
                'sentAt' => $date,
            ];
        }
        respond(200, ['campaigns' => $out]);
        break;

    case 'omnisend_campaign_stats':
        // Per-campaign opens/clicks/revenue live ONLY in Omnisend's Analytics
        // reports API (never on the campaign object). Query shape below was
        // reverse-engineered against a live account 2026-07-21: filter by
        // messageID = the campaign's id; a "custom" range needs full ISO-8601
        // timestamps (bare YYYY-MM-DD is rejected). From a fixed early date →
        // now so a campaign's all-time stats are complete regardless of age.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = (string)($_GET['id'] ?? '');
        if ($id === '') respond(400, ['error' => 'Missing id']);
        $payload = ['queries' => [[
            'alias' => 'c',
            'metrics' => [['name' => 'openedUnique'], ['name' => 'clickedUnique'], ['name' => 'attributedRevenue']],
            'dateRange' => ['interval' => 'custom', 'from' => '2015-01-01T00:00:00Z', 'to' => gmdate('Y-m-d\TH:i:s\Z')],
            'filters' => [['name' => 'messageID', 'operator' => 'in', 'values' => [$id]]],
        ]]];
        $res = omnisendApiCall('/analytics/reports', 'POST', $payload);
        if (!$res['ok']) respond(502, ['error' => $res['error']]);
        $row = $res['data']['reports'][0]['rows'][0] ?? [];
        respond(200, ['stats' => [
            'opens' => $row['openedUnique'] ?? 0,
            'clicks' => $row['clickedUnique'] ?? 0,
            'revenue' => $row['attributedRevenue'] ?? 0,
        ]]);
        break;

    case 'shopify_sales':
        // Store Update gauges (#21): today's + month-to-date sales summed from
        // the Shopify Orders REST API. Day boundaries use the SHOP's own
        // timezone (fetched from shop.json) so "today" matches what staff see
        // in Shopify admin, not the server's UTC. Only the last ~60 days of
        // orders are available by default — fine for today + MTD.
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $tok = shopifyAccessToken();
        if (!$tok['ok']) respond(502, ['error' => $tok['error']]);
        $token = $tok['token'];
        // Shop timezone/currency for correct day boundaries. If the app's scopes
        // don't let it read the shop, fall back to SHOPIFY_TIMEZONE (or UTC).
        $shopRes = shopifyApiCall('/shop.json', $token);
        $tz = ($shopRes['ok'] ? ($shopRes['data']['shop']['iana_timezone'] ?? null) : null)
            ?: (defined('SHOPIFY_TIMEZONE') && SHOPIFY_TIMEZONE ? SHOPIFY_TIMEZONE : 'UTC');
        $currency = $shopRes['ok'] ? ($shopRes['data']['shop']['currency'] ?? '') : '';
        try { $zone = new DateTimeZone($tz); } catch (Exception $e) { $zone = new DateTimeZone('UTC'); $tz = 'UTC'; }
        $now = new DateTime('now', $zone);
        $dayStart = (clone $now)->setTime(0, 0, 0);
        $weekStart = (clone $now)->modify('monday this week')->setTime(0, 0, 0); // week = Mon–today
        $monthStart = new DateTime($now->format('Y-m-01 00:00:00'), $zone);
        $today = shopifySumSales($dayStart->format('c'), $token);
        $wtd = shopifySumSales($weekStart->format('c'), $token);
        $mtd = shopifySumSales($monthStart->format('c'), $token);
        if ($today === null || $wtd === null || $mtd === null) respond(502, ['error' => 'Shopify request failed while summing orders.']);
        respond(200, ['sales' => [
            'today' => $today,
            'weekToDate' => $wtd,
            'monthToDate' => $mtd,
            'currency' => $currency,
            'timezone' => $tz,
            'asOf' => $now->format('c'),
        ]]);
        break;

    default:
        respond(404, ['error' => 'Unknown action']);
}

// ─── HELPERS ────────────────────────────────────────────────────────────

function respond($code, $data) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function bearerToken($body) {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strtolower($k) === 'authorization') { $auth = $v; break; }
        }
    }
    if (preg_match('/Bearer\s+(.+)/i', $auth, $m)) return trim($m[1]);
    if (!empty($_GET['token'])) return (string)$_GET['token'];
    if (!empty($_POST['token'])) return (string)$_POST['token'];
    if (is_array($body) && !empty($body['token'])) return (string)$body['token'];
    return '';
}

// Resolves the bearer token to a user row, touches last_seen, and prunes
// idle tokens opportunistically (>30 days). Ends the request with 401 if
// the token is missing or unknown.
function requireAuth($pdo, $body) {
    $token = bearerToken($body);
    if ($token === '') respond(401, ['error' => 'Login required']);
    pruneTokens($pdo);
    $stmt = $pdo->prepare("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? LIMIT 1");
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) respond(401, ['error' => 'Session expired, please log in again']);
    $pdo->prepare("UPDATE tokens SET last_seen = UTC_TIMESTAMP() WHERE token = ?")->execute([$token]);
    // Advance the login-history session's activity clock too (Batch 1) — this
    // is what makes a stale last_seen readable as "idle since" on the client.
    ensureLoginSessionsTable($pdo);
    $pdo->prepare("UPDATE login_sessions SET last_seen = UTC_TIMESTAMP() WHERE token = ? AND logout_at IS NULL")->execute([$token]);
    return $user;
}

function requireRole($user, $roles) {
    if (!in_array($user['role'], $roles, true)) respond(403, ['error' => 'Insufficient permissions for this action']);
}

function publicUser($user) {
    return ['id' => $user['id'], 'name' => $user['name'], 'role' => $user['role']];
}

function pruneTokens($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    $pdo->exec("DELETE FROM tokens WHERE last_seen < (UTC_TIMESTAMP() - INTERVAL 30 DAY)");
}

// Lazily create the login_sessions table (Batch 1) so an already-live DB
// picks up sign-in history on the next code deploy — no manual schema import.
// Idempotent + static-guarded, so at most one CREATE IF NOT EXISTS per request.
function ensureLoginSessionsTable($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS login_sessions (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

// The chat tables, in dump/restore order (channels before members before
// messages). Named in one place so runBackup() and restoreFromBackupData()
// iterate the same list instead of each hardcoding one — same reason
// $GK_RECORD_TABLES exists, and asserted by scripts/test_record_tables.php.
// DEFINED ABOVE THE SWITCH (see the note there) — a `global` in a request-time
// function can't see an assignment that lives further down the file.

// Lazily create the chat tables (Phase 1) so a live DB picks up staff chat on
// the next deploy — no manual import. Idempotent + static-guarded.
function ensureChatTables($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_channels (
        id VARCHAR(16) NOT NULL PRIMARY KEY, name VARCHAR(120) NULL,
        kind ENUM('channel','dm','group') NOT NULL DEFAULT 'channel',
        visibility ENUM('public','private') NOT NULL DEFAULT 'public',
        created_by VARCHAR(16) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_members (
        channel_id VARCHAR(16) NOT NULL, user_id VARCHAR(16) NOT NULL,
        last_read_msg_id BIGINT NOT NULL DEFAULT 0, joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, user_id), INDEX idx_chat_members_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, channel_id VARCHAR(16) NOT NULL, user_id VARCHAR(16) NOT NULL,
        body TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        edited_at DATETIME NULL, deleted_at DATETIME NULL, INDEX idx_chat_messages_channel (channel_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

// ─── Per-record tables (#41, step 1) ─────────────────────────────────
// The hot collections are moving off kv_store, where each one is a single
// JSON blob and every write is a read-modify-write of the whole thing (see
// kvMutate below — correct, but a whole-collection lock). One row per record
// makes a write a single statement.
//
// STEP 1 IS SCHEMA ONLY: these tables are created and backed up, but nothing
// reads or writes them yet — every action still goes through kv_store. That
// keeps this step independently revertable (drop the tables, no data moved).
//
// Table name == the kv key it will replace, so the mapping needs no lookup.
// Shape is deliberately thin: `data` holds the whole record as JSON and the
// only real columns are the ones worth filtering or sorting on server-side.
// Resisting a column per field is what keeps this from becoming a week of
// schema design — the JSON column carries the long tail.
//
// ponytail: the backlog note also listed an `assignee_id` column, deliberately
// dropped — tasks and content are MULTI-assignee (`assigneeIds[]`) since Batch
// 3, so one column can't answer "assigned to me" anyway. That filter stays in
// the JSON (and client-side, where it already runs). Add a proper
// record_assignees join table if assignment ever needs a server-side query.
//
// `version` is here for #40 (optimistic concurrency: client sends the version
// it last saw, server rejects a stale write). Free to add now while the schema
// is being written; retrofitting it across every table later is pure rework.
// The spec itself is DEFINED ABOVE THE SWITCH (see the note there): it's a
// variable assignment, so a `global` in a request-time function can only see it
// if the assignment already ran.

// The CREATE for one record table. Shared by ensureRecordTables() and the
// DB-free check in scripts/test_record_tables.php, so the test asserts against
// the same SQL that actually runs.
function recordTableSql($table, array $cols) {
    $extra = '';
    $index = '';
    foreach ($cols as $col => $type) {
        $extra .= "        $col $type NULL,\n";
        $index .= ",\n        INDEX idx_{$table}_{$col} ($col)";
    }
    // LONGTEXT, not the JSON type: nothing here uses MySQL JSON functions, and
    // LONGTEXT works on every MySQL/MariaDB version cPanel might be running.
    return "CREATE TABLE IF NOT EXISTS $table (
        id VARCHAR(24) NOT NULL PRIMARY KEY,
        data LONGTEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
$extra        INDEX idx_{$table}_updated (updated_at)$index
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
}

// Lazily created like ensureChatTables/ensureLoginSessionsTable, so a live DB
// picks these up on the next deploy with no manual schema import.
function ensureRecordTables($pdo) {
    global $GK_RECORD_TABLES;
    static $done = false;
    if ($done) return;
    $done = true;
    foreach ($GK_RECORD_TABLES as $table => $cols) {
        $pdo->exec(recordTableSql($table, $cols));
    }
}

// ── #41 step 3: per-record rows for `tasks` ───────────────────────────────
// A record table's real columns are named after the JSON field they mirror,
// snake_case for camelCase (due_date <- dueDate). Deriving beats maintaining a
// per-collection field map that can drift from the schema.
// scripts/migrate_kv_to_rows.php lifts these two out of this file, so the
// migration and the live write path can never build a row differently.
function recordFieldForColumn($col) {
    return preg_replace_callback('/_([a-z])/', fn($m) => strtoupper($m[1]), $col);
}

// One record -> the row to write. `data` keeps the WHOLE record, so the row is
// a lossless replacement for the JSON entry and nothing depends on having
// modelled every field as a column.
function recordRow(array $record, array $cols) {
    // `_v` is the version column echoed back by recordAll, not a field of the
    // record — storing it inside `data` would freeze a stale number into the
    // JSON and make every later comparison meaningless.
    unset($record['_v']);
    $row = [
        'id' => (string)$record['id'],
        'data' => json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'version' => 1,
    ];
    foreach ($cols as $col => $type) {
        $val = $record[recordFieldForColumn($col)] ?? null;
        if (is_array($val) || is_object($val)) $val = null; // scalar columns only
        if ($val === '') $val = null;
        if ($val !== null && strncmp($type, 'DATE', 4) === 0) {
            // The app stores "" for "no date"; a DATE column would either reject
            // that or quietly store 0000-00-00. Anything not a real Y-m-d
            // (a full ISO timestamp, junk) becomes NULL rather than a bogus date.
            $val = preg_match('/^(\d{4}-\d{2}-\d{2})/', (string)$val, $m) ? $m[1] : null;
        }
        $row[$col] = $val === null ? null : (string)$val;
    }
    return $row;
}

// Insert-or-replace one record. version increments on update so #40's
// optimistic-concurrency check has something to compare against later.
function recordUpsert($pdo, $table, array $record) {
    global $GK_RECORD_TABLES;
    $row = recordRow($record, $GK_RECORD_TABLES[$table]);
    $names = array_keys($row);
    $sets = [];
    foreach ($names as $c) {
        if ($c === 'id' || $c === 'version') continue;
        $sets[] = "$c = VALUES($c)";
    }
    $sets[] = 'version = version + 1';
    $pdo->prepare(
        "INSERT INTO $table (" . implode(', ', $names) . ")
         VALUES (" . implode(', ', array_fill(0, count($names), '?')) . ")
         ON DUPLICATE KEY UPDATE " . implode(', ', $sets)
    )->execute(array_values($row));
}

// Every record in a table, as the client already expects to receive them.
// ORDER BY id, not updated_at: an edit must not reshuffle the list under
// anyone. Display order is decided client-side (sortTasksForUser and friends),
// so this only needs to be deterministic.
function recordAll($pdo, $table) {
    $out = [];
    foreach ($pdo->query("SELECT data, version FROM $table ORDER BY id") as $r) {
        $rec = json_decode($r['data'], true);
        // `_v` is server-managed metadata, not part of the record: stored as a
        // column, injected on read, stripped on write (see recordRow). The
        // client round-trips it without knowing what it is, which is what makes
        // the #40 conflict check work with no client bookkeeping.
        if (is_array($rec)) { $rec['_v'] = (int)$r['version']; $out[] = $rec; }
    }
    return $out;
}

// Rewrites every record through $fn — for the cascades that follow a delete.
function recordMapAll($pdo, $table, callable $fn) {
    foreach (recordAll($pdo, $table) as $rec) {
        $next = $fn($rec);
        if ($next !== $rec) recordUpsert($pdo, $table, $next);
    }
    return recordAll($pdo, $table);
}

// One-time copy of the kv `tasks` doc into the tasks table, run lazily on the
// first request that touches tasks.
//
// This exists so deploying step 3 can't empty anyone's task list: the table is
// created empty, and without this the first kv_all after a deploy would report
// zero tasks while the real ones sat untouched in kv_store. Doing it here rather
// than only in scripts/migrate_kv_to_rows.php means the deploy needs no SSH step
// and no ordering discipline from whoever ships it.
//
// Idempotent twice over: guarded by a kv marker, and the upserts are
// insert-or-replace, so two concurrent first-requests can't duplicate anything.
// The kv `tasks` doc is deliberately left in place, frozen, as the rollback —
// nothing writes it again, and reverting means pointing reads back at it.
function isRecordTable($key) {
    global $GK_RECORD_TABLES;
    return isset($GK_RECORD_TABLES[$key]);
}

function ensureCollectionMigrated($pdo, $key) {
    static $done = [];
    if (isset($done[$key])) return;
    $done[$key] = true;
    if (!isRecordTable($key)) return;
    ensureRecordTables($pdo);
    $marker = kvGet($pdo, $key . 'RowsMigrated');
    if (is_array($marker) && !empty($marker['at'])) return;
    $legacy = kvGet($pdo, $key);
    $n = 0;
    if (is_array($legacy)) {
        foreach ($legacy as $rec) {
            if (!is_array($rec) || ($rec['id'] ?? '') === '') continue;
            recordUpsert($pdo, $key, $rec);
            $n++;
        }
    }
    kvSet($pdo, $key . 'RowsMigrated', ['at' => gmdate('c'), 'count' => $n]);
}

function ensureTasksMigrated($pdo) { ensureCollectionMigrated($pdo, 'tasks'); }

// #40 optimistic concurrency. `_v` is injected into every record on read and
// round-trips through the client untouched (the UI spreads records, so it
// survives edits). If the row has moved on since the client last saw it, the
// save is refused instead of silently overwriting a coworker's field changes.
//
// Absent `_v` means "client isn't tracking versions" (an older build, or a
// record it just created), which must still save — this can't become a wall
// that blocks writes from anything that hasn't been updated yet.
// Returns the current version on conflict, null when the save may proceed.
function recordConflict($pdo, $table, array $record) {
    if (!isset($record['_v'])) return null;
    $s = $pdo->prepare("SELECT version FROM $table WHERE id = ? LIMIT 1");
    $s->execute([(string)$record['id']]);
    $cur = $s->fetch();
    if (!$cur) return null; // brand new record — nothing to conflict with
    return ((int)$cur['version'] !== (int)$record['_v']) ? (int)$cur['version'] : null;
}

// Can this user see the channel? Public channels are visible to all; others
// require a chat_members row. Archived channels are hidden.
function chatCanSee($pdo, $channelId, $userId) {
    if ($channelId === '') return false;
    $s = $pdo->prepare("SELECT visibility FROM chat_channels WHERE id = ? AND archived = 0 LIMIT 1");
    $s->execute([$channelId]);
    $c = $s->fetch();
    if (!$c) return false;
    if ($c['visibility'] === 'public') return true;
    $m = $pdo->prepare("SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ? LIMIT 1");
    $m->execute([$channelId, $userId]);
    return (bool)$m->fetch();
}

function kvGet($pdo, $key) {
    $stmt = $pdo->prepare("SELECT v FROM kv_store WHERE k = ? LIMIT 1");
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if (!$row || $row['v'] === null) return null;
    return json_decode($row['v'], true);
}

function kvSet($pdo, $key, $value) {
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $pdo->prepare(
        "INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = UTC_TIMESTAMP()"
    )->execute([$key, $json]);
}

// Atomic read-modify-write of one kv row. $fn receives the decoded current
// value and returns the value to store.
//
// Every per-record write in this file is a read-modify-write of a whole JSON
// collection, and doing that as a bare SELECT-then-write loses updates: two
// concurrent requests both read the same list, each adds its own record, and
// the second write drops the first. That is not theoretical — the "seed the 12
// standard sections" button fires 12 unawaited category_save calls at once, and
// only 4 of the 12 categories survived before this existed.
//
// SELECT ... FOR UPDATE holds an exclusive row lock until the surrounding
// transaction commits, so concurrent writers to the same key serialize instead
// of racing. The INSERT IGNORE first guarantees there is a row to lock (FOR
// UPDATE on a nonexistent row locks a gap, not a row).
//
// Nest-safe: if a caller already opened a transaction (restoreFromBackupData),
// this joins it rather than committing early.
function kvMutate($pdo, $key, callable $fn) {
    // The row has to exist before it can be locked: SELECT ... FOR UPDATE on a
    // missing row takes a gap lock, not a row lock, so concurrent writers to a
    // brand-new key wouldn't serialize at all.
    //
    // This INSERT must be its own committed statement, OUTSIDE the transaction.
    // Doing it inside and then upgrading to FOR UPDATE is a lock upgrade, which
    // InnoDB resolves by killing one of the contending transactions — measured
    // at 5 of 12 concurrent writes dying with SQLSTATE 40001 when it lived
    // inside the transaction.
    $ensure = fn() => $pdo->prepare(
        "INSERT IGNORE INTO kv_store (k, v, updated_at) VALUES (?, NULL, UTC_TIMESTAMP())"
    )->execute([$key]);

    // Already inside someone else's transaction (restoreFromBackupData): join
    // it. Nothing to retry against there, and nothing concurrent either.
    if ($pdo->inTransaction()) {
        $ensure();
        return kvMutateLocked($pdo, $key, $fn);
    }
    $ensure();

    // Retry on deadlock (1213) and lock wait timeout (1205). Every one of these
    // writes is fire-and-forget from the browser — nothing retries it and the
    // user is never told — so an aborted transaction here IS silent data loss.
    // $fn re-runs on retry, which is safe: the rollback undid everything it did,
    // including sop_save's revision insert.
    $delayUs = 15000;
    for ($attempt = 1; ; $attempt++) {
        $pdo->beginTransaction();
        try {
            $next = kvMutateLocked($pdo, $key, $fn);
            $pdo->commit();
            return $next;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $errno = ($e instanceof PDOException && isset($e->errorInfo[1])) ? (int)$e->errorInfo[1] : 0;
            if ($attempt >= 6 || ($errno !== 1213 && $errno !== 1205)) throw $e;
            usleep($delayUs + random_int(0, $delayUs)); // jittered backoff
            $delayUs = min($delayUs * 2, 250000);
        }
    }
}

// The locked read-modify-write itself. Always called with a transaction open.
function kvMutateLocked($pdo, $key, callable $fn) {
    $stmt = $pdo->prepare("SELECT v FROM kv_store WHERE k = ? FOR UPDATE");
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    $current = ($row && $row['v'] !== null) ? json_decode($row['v'], true) : null;
    $next = $fn($current);
    kvSet($pdo, $key, $next);
    return $next;
}

// Safe read-merge-write for the per-record collection actions (tasks,
// projects, campaigns, content, categories). Re-reads the current list
// fresh from the DB inside the request, replaces just the matching record
// (or appends if new), and writes the merged array back — so two staff
// editing different records in the same collection concurrently never
// wipe each other out, unlike a blind whole-array kv_set.
function collectionUpsert($pdo, $key, $item) {
    return kvMutate($pdo, $key, function ($list) use ($item) {
        if (!is_array($list)) $list = [];
        $idx = null;
        foreach ($list as $i => $x) { if (($x['id'] ?? null) === $item['id']) { $idx = $i; break; } }
        if ($idx !== null) { $list[$idx] = $item; } else { $list[] = $item; }
        return $list;
    });
}

function collectionDelete($pdo, $key, $id) {
    return kvMutate($pdo, $key, function ($list) use ($id) {
        if (!is_array($list)) $list = [];
        return array_values(array_filter($list, fn($x) => ($x['id'] ?? null) !== $id));
    });
}

// collectionMapAll() was deleted by #41 step 5 — every cascade it served
// (category->sops, project->tasks, campaign->content) now runs on rows via
// recordMapAll(). collectionUpsert/collectionDelete below survive because
// `taskTemplates` is still a kv collection, and kvMutate survives because
// navAccess, the three acks maps and icsTokens are merge-maps that genuinely
// need a locked read-modify-write — that is what it is for, not a leftover.

// The kv docs that are a single document wrapping one list of identified items
// (Image Repository, Tools & Prompts, the Playbook's pages). Per-item writes
// merge into these server-side, so two editors adding different entries no
// longer overwrite each other. Allowlisted, so doc_item_save can't be pointed
// at an arbitrary key like "tasks".
function docListField($key) {
    $map = ['imagerepo' => 'blocks', 'toolsPrompts' => 'items', 'playbook' => 'sections'];
    return $map[$key] ?? null;
}

function docItemUpsert($pdo, $key, $field, $item) {
    return kvMutate($pdo, $key, function ($doc) use ($field, $item) {
        if (!is_array($doc)) $doc = [];
        $list = isset($doc[$field]) && is_array($doc[$field]) ? $doc[$field] : [];
        $idx = null;
        foreach ($list as $i => $x) { if (($x['id'] ?? null) === $item['id']) { $idx = $i; break; } }
        if ($idx !== null) { $list[$idx] = $item; } else { $list[] = $item; }
        $doc[$field] = $list;
        return $doc;
    });
}

function docItemDelete($pdo, $key, $field, $id) {
    return kvMutate($pdo, $key, function ($doc) use ($field, $id) {
        if (!is_array($doc)) $doc = [];
        $list = isset($doc[$field]) && is_array($doc[$field]) ? $doc[$field] : [];
        $doc[$field] = array_values(array_filter($list, fn($x) => ($x['id'] ?? null) !== $id));
        return $doc;
    });
}

// The *_save/*_delete cases above (task, project, campaign, content,
// category, tag, contact, instance, template) were all the same 6-7 lines
// of editor/admin gate + validate + backup + upsert-or-delete, differing
// only in the body key and kv key — collapsed here so a future tweak to
// that flow (e.g. the validation or the auto-backup call) happens once.
// alert_save/alert_delete stay hand-written in the switch above: any
// authenticated user (not just editor/admin) may create one, and delete
// has an ownership check instead of a plain role gate.
// Collections listed in $GK_RECORD_TABLES are stored one row per record (#41);
// everything else is still one JSON blob in kv_store. Routing both through here
// means a collection migrates by joining that list — no per-endpoint edits —
// and the response shape is identical either way, so the client never knows.
function handleCollectionSave($pdo, $body, $user, $bodyKey, $kvKey) {
    requireRole($user, ['editor', 'admin']);
    $item = $body[$bodyKey] ?? null;
    if (!is_array($item) || empty($item['id'])) respond(400, ['error' => 'Missing ' . $bodyKey]);
    maybeAutoBackup($pdo);
    if (isRecordTable($kvKey)) {
        ensureCollectionMigrated($pdo, $kvKey);
        $theirs = recordConflict($pdo, $kvKey, $item);
        if ($theirs !== null) {
            // #40: this record moved on since the client last read it. Refuse
            // rather than overwrite a coworker's field changes, and send the
            // current collection back so the UI can show their version. Nothing
            // is discarded — the user still has their edit on screen.
            respond(409, [
                'error' => 'Someone else changed this while you were editing. Reload to see their version, then re-apply your change.',
                'conflict' => true,
                $kvKey => recordAll($pdo, $kvKey),
            ]);
        }
        recordUpsert($pdo, $kvKey, $item);
        respond(200, ['ok' => true, $kvKey => recordAll($pdo, $kvKey)]);
    }
    respond(200, ['ok' => true, $kvKey => collectionUpsert($pdo, $kvKey, $item)]);
}

// $cascade (optional) runs after the delete and returns extra collections to
// merge into the response, so the client can refresh its cache from real data
// instead of rewriting a second whole collection from its own stale copy.
function handleCollectionDelete($pdo, $body, $user, $kvKey, $cascade = null) {
    requireRole($user, ['editor', 'admin']);
    $id = $body['id'] ?? '';
    if ($id === '') respond(400, ['error' => 'Missing id']);
    maybeAutoBackup($pdo);
    if (isRecordTable($kvKey)) {
        ensureCollectionMigrated($pdo, $kvKey);
        $pdo->prepare("DELETE FROM $kvKey WHERE id = ?")->execute([$id]);
        $out = ['ok' => true, $kvKey => recordAll($pdo, $kvKey)];
    } else {
        $out = ['ok' => true, $kvKey => collectionDelete($pdo, $kvKey, $id)];
    }
    if ($cascade) $out = array_merge($out, $cascade($pdo, $id));
    respond(200, $out);
}

// Minimal curl wrapper for cPanel's UAPI (Authorization: cpanel header).
// Cert verification stays ON (CURLOPT_SSL_VERIFYPEER true) — never disable
// this. Returns a structured result so callers can surface raw error text
// to the admin rather than swallowing it.
function cpanelApiCall($url, $params, $authHeader) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url . '?' . http_build_query($params),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [$authHeader],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CUSTOMREQUEST => 'GET',
    ]);
    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch) ?: null;
    $data = $raw !== false && $raw !== null ? json_decode($raw, true) : null;
    return [
        'httpCode' => $httpCode,
        'curlError' => $curlError,
        'data' => $data,
        // Only kept when the response wasn't valid JSON, to aid debugging
        // without bloating every successful response.
        'rawExcerpt' => $data === null ? substr((string)$raw, 0, 2000) : null,
    ];
}

// RFC 5545 text escaping for ICS SUMMARY/DESCRIPTION values.
function icsEscape($s) {
    $s = str_replace(['\\', "\n", "\r", ',', ';'], ['\\\\', '\\n', '', '\\,', '\\;'], (string)$s);
    return $s;
}

// Minimal curl wrapper for Omnisend's current dated API (api-docs.omnisend.com,
// version 2026-03-15) — NOT the old /v3 path, which used a bare X-API-KEY
// header; that scheme is no longer accepted (confirmed 2026-07-21 after a
// live request returned "API key or access token not provided"). Current
// auth is `Authorization: Omnisend-API-Key <key>` + a required Omnisend-Version
// header. Returns {ok, data, error}. Key stays server-side — never returned
// to the client.
function omnisendApiCall($path, $method = 'GET', $reqBody = null) {
    if (!defined('OMNISEND_API_KEY') || OMNISEND_API_KEY === '' || strpos(OMNISEND_API_KEY, 'PASTE_') === 0) {
        return ['ok' => false, 'error' => 'Omnisend is not configured yet. Add OMNISEND_API_KEY to config.php.'];
    }
    $ch = curl_init();
    $opts = [
        CURLOPT_URL => 'https://api.omnisend.com/api' . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Omnisend-API-Key ' . OMNISEND_API_KEY,
            'Omnisend-Version: 2026-03-15',
            'Accept: application/json',
            'Content-Type: application/json',
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
    ];
    if ($method === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode($reqBody);
    }
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch) ?: null;
    if ($curlError) return ['ok' => false, 'error' => 'Omnisend request failed: ' . $curlError];
    $data = $raw !== false ? json_decode($raw, true) : null;
    if ($httpCode < 200 || $httpCode >= 300) {
        return ['ok' => false, 'error' => 'Omnisend returned HTTP ' . $httpCode . (is_array($data) && isset($data['error']) ? ' — ' . $data['error'] : '')];
    }
    return ['ok' => true, 'data' => is_array($data) ? $data : []];
}

// Exchanges the Dev Dashboard app's Client ID/secret for a short-lived Admin
// API token via the client_credentials grant. Legacy copy-a-static-token
// custom apps were retired 2026-01-01, so this is the single-store flow now.
// The token lasts ~24h; we fetch fresh per Store Update request.
// ponytail: no caching — the extra POST is negligible at dashboard-refresh
// volume; cache to a server-side file (NOT kv_store, which the client can read
// via kv_all) if it ever matters. Returns {ok, token, error}.
function shopifyAccessToken() {
    if (!defined('SHOPIFY_STORE_DOMAIN') || SHOPIFY_STORE_DOMAIN === '' || strpos(SHOPIFY_STORE_DOMAIN, 'PASTE_') === 0
        || !defined('SHOPIFY_CLIENT_ID') || SHOPIFY_CLIENT_ID === '' || strpos(SHOPIFY_CLIENT_ID, 'PASTE_') === 0
        || !defined('SHOPIFY_CLIENT_SECRET') || SHOPIFY_CLIENT_SECRET === '' || strpos(SHOPIFY_CLIENT_SECRET, 'PASTE_') === 0) {
        return ['ok' => false, 'error' => 'Shopify is not configured yet. Add SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET to config.php.'];
    }
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://' . SHOPIFY_STORE_DOMAIN . '/admin/oauth/access_token',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'client_credentials',
            'client_id' => SHOPIFY_CLIENT_ID,
            'client_secret' => SHOPIFY_CLIENT_SECRET,
        ]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch) ?: null;
    if ($err) return ['ok' => false, 'error' => 'Shopify auth failed: ' . $err];
    $data = $raw !== false ? json_decode($raw, true) : null;
    if ($code < 200 || $code >= 300 || empty($data['access_token'])) {
        return ['ok' => false, 'error' => 'Shopify token request returned HTTP ' . $code . (is_array($data) && isset($data['error_description']) ? ' — ' . $data['error_description'] : '')];
    }
    return ['ok' => true, 'token' => $data['access_token']];
}

// Shopify Admin REST API wrapper. Auth via a client_credentials access token
// (see shopifyAccessToken). Accepts a relative path ("/orders.json?...") or an
// absolute URL (used to follow the Link-header "next" cursor for pagination).
// Returns {ok, data, error, nextUrl}.
// ponytail: REST is Shopify's "legacy" API but still supported; upgrade path is
// the GraphQL Admin API (or ShopifyQL for aggregates) only if REST is dropped.
function shopifyApiCall($pathOrUrl, $token) {
    $ver = (defined('SHOPIFY_API_VERSION') && SHOPIFY_API_VERSION) ? SHOPIFY_API_VERSION : '2025-07';
    $url = strpos($pathOrUrl, 'http') === 0 ? $pathOrUrl : ('https://' . SHOPIFY_STORE_DOMAIN . '/admin/api/' . $ver . $pathOrUrl);
    $respHeaders = [];
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-Shopify-Access-Token: ' . $token, 'Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HEADERFUNCTION => function ($ch, $header) use (&$respHeaders) { $respHeaders[] = $header; return strlen($header); },
    ]);
    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch) ?: null;
    if ($curlError) return ['ok' => false, 'error' => 'Shopify request failed: ' . $curlError];
    $data = $raw !== false ? json_decode($raw, true) : null;
    if ($httpCode < 200 || $httpCode >= 300) {
        return ['ok' => false, 'error' => 'Shopify returned HTTP ' . $httpCode];
    }
    $nextUrl = null;
    foreach ($respHeaders as $h) {
        if (stripos($h, 'Link:') === 0 && preg_match('/<([^>]+)>;\s*rel="next"/i', $h, $m)) $nextUrl = $m[1];
    }
    return ['ok' => true, 'data' => is_array($data) ? $data : [], 'nextUrl' => $nextUrl];
}

// Sums order total_price (post-discount/refund, store currency) for orders
// created since $minIso, following the Link cursor. Skips cancelled orders.
// Returns a float, or null if any page request fails.
// ponytail: 40-page cap (~10k orders) bounds runtime — a single shop day/month
// won't approach that; raise if it ever does.
function shopifySumSales($minIso, $token) {
    $sum = 0.0;
    $next = '/orders.json?status=any&limit=250&fields=total_price,cancelled_at&created_at_min=' . rawurlencode($minIso);
    $pages = 0;
    while ($next && $pages < 40) {
        $res = shopifyApiCall($next, $token);
        if (!$res['ok']) return null;
        foreach (($res['data']['orders'] ?? []) as $o) {
            if (!empty($o['cancelled_at'])) continue;
            $sum += (float)($o['total_price'] ?? 0);
        }
        $next = $res['nextUrl'] ?? null;
        $pages++;
    }
    return round($sum, 2);
}

function saveRevision($pdo, $sopId, $snapshot, $savedBy) {
    $json = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $pdo->prepare("INSERT INTO revisions (sop_id, snapshot, saved_at, saved_by) VALUES (?, ?, UTC_TIMESTAMP(), ?)")
        ->execute([$sopId, $json, $savedBy]);
    // Cap 20 per SOP — delete anything older than the newest 20.
    $stmt = $pdo->prepare("SELECT id FROM revisions WHERE sop_id = ? ORDER BY saved_at DESC, id DESC LIMIT 20, 999");
    $stmt->execute([$sopId]);
    $oldIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if ($oldIds) {
        $placeholders = implode(',', array_fill(0, count($oldIds), '?'));
        $pdo->prepare("DELETE FROM revisions WHERE id IN ($placeholders)")->execute($oldIds);
    }
}

// Ignores updatedAt/updatedBy so touching metadata alone (e.g. a status
// toggle with no other edits) doesn't spam the revision history.
function sopContentChanged($old, $new) {
    $strip = function ($s) {
        if (!is_array($s)) return $s;
        unset($s['updatedAt'], $s['updatedBy']);
        return $s;
    };
    return json_encode($strip($old)) !== json_encode($strip($new));
}

function ensureUploadsDir($monthFolder) {
    $root = GK_UPLOADS_DIR;
    if (!is_dir($root)) mkdir($root, 0755, true);
    $htaccess = $root . '/.htaccess';
    if (!file_exists($htaccess)) {
        // Uploads must stay servable (they're images), but never executed as PHP.
        file_put_contents($htaccess, "php_flag engine off\nAddType text/plain .php .php3 .php4 .php5 .phtml .pht\n");
    }
    $dir = $root . '/' . $monthFolder;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir;
}

// Dump format version. BUMP THIS whenever a table joins the dump, and old
// snapshots are purged on the next deploy (see ensureBackupsDir).
//
//   1 — kv_store, users, revisions
//   2 — + per-record tables (#41) and chat
//
// Why purge rather than keep and tolerate: restoreFromBackupData EMPTIES every
// table it manages, so restoring a format-1 dump doesn't roll chat back, it
// deletes it — the older the snapshot, the more it destroys. A backup you must
// not restore isn't a backup, so it doesn't get to sit in the list looking like
// one. Cost is real and one-time: the existing ~60 days of kv/users/revisions
// history goes with it, and history restarts at the first post-deploy backup.
// GK_BACKUP_FORMAT is defined ABOVE THE SWITCH — see the note there. define()
// is a runtime call, so declaring it here left it undefined for every request.
//
// A format-1 dump genuinely must not be restored under format-2 code:
// restoreFromBackupData EMPTIES every table it manages, and a dump with no
// 'chat' key would delete chat rather than roll it back. That is handled by
// REFUSING the restore (see backup_restore), which is where an unsafe restore
// should be stopped.
//
// It is deliberately NOT handled by deleting the old snapshots. An earlier
// revision of this function purged every gk_*.json.gz whose format marker
// didn't match, which on any existing install meant the first backup after a
// deploy silently destroyed the entire local backup history — irreversibly,
// for the cosmetic benefit of keeping unrestorable files out of a list. Old
// snapshots still hold real kv/users/revisions data worth having, they remain
// downloadable, and the restore guard already makes them harmless. Never trade
// a user's only local history for tidiness.
// ponytail: if unrestorable snapshots in the Backups list ever actually
// confuse anyone, label them in the UI from the `format` field — don't delete.
function ensureBackupsDir() {
    $dir = GK_BACKUPS_DIR;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $htaccess = $dir . '/.htaccess';
    if (!file_exists($htaccess)) {
        file_put_contents($htaccess, "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Deny from all\n</IfModule>\n");
    }
    return $dir;
}

function runBackup($pdo) {
    global $GK_RECORD_TABLES, $GK_CHAT_TABLES, $GK_PLAIN_TABLES;
    $dir = ensureBackupsDir();
    $stamp = gmdate('Ymd_His');
    $data = ['createdAt' => gmdate('c'), 'format' => GK_BACKUP_FORMAT, 'kv' => [], 'users' => [], 'revisions' => [], 'records' => [], 'chat' => [], 'tables' => []];
    foreach ($pdo->query("SELECT k, v, updated_at FROM kv_store") as $row) $data['kv'][] = $row;
    // Hashes only — never plaintext PINs — so users are safe to keep in the dump.
    foreach ($pdo->query("SELECT id, name, pin_hash, role, created_at FROM users") as $row) $data['users'][] = $row;
    foreach ($pdo->query("SELECT id, sop_id, snapshot, saved_at, saved_by FROM revisions") as $row) $data['revisions'][] = $row;

    // Per-record tables (#41). Backed up from step 1, BEFORE anything writes to
    // them — because this function and restoreFromBackupData both enumerate
    // tables explicitly, so a table added here later than the code that fills it
    // means backups silently stop covering data that moved out of kv_store.
    // That is the single most likely way this migration loses data; the coverage
    // assertion in scripts/test_record_tables.php exists to keep it impossible.
    // Empty tables just dump as empty arrays while the migration is unfinished.
    ensureRecordTables($pdo);
    foreach (array_keys($GK_RECORD_TABLES) as $table) {
        $rows = [];
        foreach ($pdo->query("SELECT * FROM $table") as $row) $rows[] = $row;
        $data['records'][$table] = $rows;
    }

    // Chat (channels/members/messages). Same trap as the record tables: these
    // were live for months while this function dumped only kv_store, users and
    // revisions, so every chat message was outside every backup.
    ensureChatTables($pdo);
    foreach ($GK_CHAT_TABLES as $table) {
        $rows = [];
        foreach ($pdo->query("SELECT * FROM $table") as $row) $rows[] = $row;
        $data['chat'][$table] = $rows;
    }

    // Plain tables (login history). Same explicit-enumeration trap as above.
    ensureLoginSessionsTable($pdo);
    foreach ($GK_PLAIN_TABLES as $table) {
        $rows = [];
        foreach ($pdo->query("SELECT * FROM $table") as $row) $rows[] = $row;
        $data['tables'][$table] = $rows;
    }

    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // Never overwrite an existing snapshot. The stamp is second-resolution, so
    // two backups in the same second land on the same name — and because
    // backup_restore takes its safety snapshot BEFORE reading the file being
    // restored, that collision used to truncate the very backup being restored
    // and then "successfully" restore the already-broken current state. Suffix
    // on collision instead; the extra "_N" still matches the gk_[0-9_]+ pattern
    // backup_download/backup_restore validate against.
    $path = $dir . "/gk_$stamp.json.gz";
    for ($n = 1; file_exists($path); $n++) $path = $dir . "/gk_{$stamp}_$n.json.gz";

    // Write to a temp file and rename into place, so a failed/partial write
    // never leaves a truncated file that LOOKS like the newest good backup
    // (which would also suppress maybeAutoBackup for the next 24h).
    $tmp = $path . '.part';
    $gz = @gzopen($tmp, 'wb9');
    if ($gz === false) { @unlink($tmp); throw new Exception('Could not open the backups directory for writing.'); }
    $written = gzwrite($gz, $json);
    gzclose($gz);
    if ($written === false || $written < strlen($json) || !@rename($tmp, $path)) {
        @unlink($tmp);
        throw new Exception('Backup write failed — the snapshot was not saved.');
    }

    // Keep the newest 240. Retention is a file COUNT, so it multiplies with the
    // auto-backup interval in maybeAutoBackup: 60 files at the old 24h was
    // ~60 days of history, and leaving it at 60 alongside the new 6h interval
    // would have quietly cut that to ~15 days. 240 restores the same ~60-day
    // reach. Cost is disk — 240 × the gzipped dump size. Lower this (or raise
    // the interval) if the dump ever grows enough for that to bite.
    $files = glob($dir . '/gk_*.json.gz');
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach (array_slice($files, 240) as $old) @unlink($old);

    return basename($path);
}

function listBackups() {
    $dir = ensureBackupsDir();
    $files = [];
    foreach (glob($dir . '/gk_*.json.gz') as $f) {
        $files[] = ['file' => basename($f), 'createdAt' => date('c', filemtime($f)), 'sizeMB' => round(filesize($f) / 1048576, 3)];
    }
    usort($files, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    return $files;
}

// Cheap staleness check — runs on every authenticated write. glob() over a
// folder capped at 60 files is effectively free at this scale.
// Deliberately swallows backup failures: this is opportunistic, and a full or
// unwritable disk must not make the app unwritable too. A missed snapshot shows
// up as a stale date in Admin Panel → Backups, which is the visible signal.
function maybeAutoBackup($pdo) {
    $dir = ensureBackupsDir();
    $files = glob($dir . '/gk_*.json.gz');
    try {
        if (!$files) { runBackup($pdo); return; }
        usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
        // 6h, not 24h: this bounds how much work a restore can lose, and the
        // daily cron doesn't narrow it. Retention is a file count (60), so a
        // shorter interval trades history depth for a tighter loss window —
        // ~15 days of snapshots instead of ~60. Worth revisiting together if
        // the real dump ever gets big enough for that to matter.
        if (time() - filemtime($files[0]) > 6 * 3600) runBackup($pdo);
    } catch (Exception $e) { /* see above */ }
}

// ── OFF-SITE BACKUP COPY (Backblaze B2) ───────────────────────────────────
// backups/ lives on the same cPanel account as the database, so one deleted or
// compromised account loses both copies at once. This pushes a second copy to
// Backblaze B2 after each explicit backup run. 10 GB free tier.
//
// Deliberately NOT wired into maybeAutoBackup: that fires inside an ordinary
// user's save request, and a synchronous HTTPS upload there would add ~a second
// to saving a task. The daily cron (backup_run) carries the off-site copy; the
// 6-hourly local snapshots stay local. That means off-site granularity is
// daily, local is 6-hourly — a deliberate trade, documented in DEPLOY.md.
//
// B2's native API was chosen over its S3-compatible endpoint because the S3 one
// needs AWS SigV4 request signing (an HMAC chain, ~60 lines of fiddly crypto);
// the native API is plain Basic auth plus two JSON calls. Chosen over Dropbox
// because setup is two values copied from a UI rather than an OAuth
// authorize-then-exchange dance.
// ponytail: B2 only, no provider abstraction — swapping destination is
// replacing b2Authorize + offsiteUpload, not adding an interface.
// ponytail: API v2. v3 is current and nests apiUrl under apiInfo.storageApi;
// move to it if B2 ever retires v2.
function offsiteConfigured() {
    foreach (['B2_KEY_ID', 'B2_APPLICATION_KEY'] as $c) {
        if (!defined($c)) return false;
        // trim(): these are pasted into config.php through cPanel's File
        // Manager, which makes a trailing space or newline easy to include and
        // invisible afterwards. Untrimmed, one stray character produces a B2
        // "401 bad_auth_token" that looks exactly like a wrong key.
        $v = trim((string)constant($c));
        if ($v === '' || strncmp($v, 'PASTE_', 6) === 0) return false;
    }
    return true;
}

// Credentials as B2 should receive them — trimmed, so pasted whitespace can't
// break the Basic-auth handshake. Single source for every B2 call.
function b2Credentials() {
    return [trim((string)B2_KEY_ID), trim((string)B2_APPLICATION_KEY)];
}

// Is this request's cron_key good enough to skip the admin login? Pure, so the
// four outcomes are checkable without a server (scripts/test_backup_auth.php).
//   accept               -> run as the cron
//   no_key               -> nothing supplied; fall back to normal admin auth
//   reject_unconfigured  -> key supplied, but CRON_KEY isn't usable in config
//   reject_mismatch      -> key supplied, doesn't match
function cronKeyVerdict($supplied, $configured) {
    $supplied = trim((string)$supplied);
    if ($supplied === '') return 'no_key';
    $configured = trim((string)($configured ?? ''));
    if ($configured === '' || strncmp($configured, 'PASTE_', 6) === 0) return 'reject_unconfigured';
    // hash_equals: constant-time, so a wrong key can't be discovered byte by
    // byte from response timing.
    return hash_equals($configured, $supplied) ? 'accept' : 'reject_mismatch';
}

// What to tell whoever is setting the cron up. Names the likely causes rather
// than the value, which must never appear in a response.
function cronKeyHint($configured) {
    $c = trim((string)($configured ?? ''));
    if ($c === '' || strncmp($c, 'PASTE_', 6) === 0) {
        return 'cron_key was supplied, but CRON_KEY is not set in config.php (or is still the PASTE_… placeholder). '
             . 'Set it to a long random value, then use that same value in the cron URL.';
    }
    return 'cron_key does not match CRON_KEY in config.php. Check for a typo, a stray space in either place, '
         . 'that you replaced YOUR_CRON_KEY in the URL with the real value, and that the key contains no '
         . 'characters that need URL-encoding (& + % # or spaces) — letters and digits only is safest.';
}

// B2 puts the useful text in "code" ("bad_auth_token", "unauthorized") and
// frequently leaves "message" empty, so prefer whichever is populated — and
// never emit a bare "— " with nothing after it, since this string is what an
// admin reads off the Backups tile when something has broken.
function b2Detail($d, $raw = '') {
    $t = '';
    if (is_array($d)) {
        $t = trim((string)($d['message'] ?? ''));
        if ($t === '') $t = trim((string)($d['code'] ?? ''));
    }
    if ($t === '') $t = trim(substr((string)$raw, 0, 200));
    return $t === '' ? '' : ' — ' . $t;
}

// Basic-auth handshake. Returns the short-lived token plus the api host to use
// and, for a bucket-restricted key, the bucket it's scoped to — which is why
// B2_BUCKET_ID is optional in config.php.
function b2Authorize() {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => implode(':', b2Credentials()),
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch) ?: null;
    if ($err) return ['ok' => false, 'error' => 'B2 auth failed: ' . $err];
    $d = $raw !== false ? json_decode($raw, true) : null;
    if ($code < 200 || $code >= 300 || empty($d['authorizationToken']) || empty($d['apiUrl'])) {
        // B2's own message is the useful part ("bad_auth_token", "unauthorized").
        return ['ok' => false, 'error' => 'B2 auth returned HTTP ' . $code . b2Detail($d, $raw)];
    }
    $bucketId = defined('B2_BUCKET_ID') && B2_BUCKET_ID !== '' && strpos((string)B2_BUCKET_ID, 'PASTE_') !== 0
        ? B2_BUCKET_ID
        : ($d['allowed']['bucketId'] ?? '');
    if ($bucketId === '') {
        return ['ok' => false, 'error' => 'B2 key is not restricted to a bucket, so set B2_BUCKET_ID in config.php.'];
    }
    return ['ok' => true, 'token' => $d['authorizationToken'], 'apiUrl' => rtrim($d['apiUrl'], '/'), 'bucketId' => $bucketId];
}

// Uploads one backup file. Returns ['ok'=>bool, 'error'=>?string].
// $remoteName lets the uploads mirror preserve a relative path
// (uploads/2026-08/x.jpg) instead of flattening every month folder into one
// namespace; backups keep passing just a filename.
function offsiteUpload($path, $remoteName = null) {
    if (!offsiteConfigured()) return ['ok' => false, 'error' => 'not configured'];
    if (!is_file($path)) return ['ok' => false, 'error' => 'local backup file missing'];
    $auth = b2Authorize();
    if (!$auth['ok']) return ['ok' => false, 'error' => $auth['error']];

    // B2 hands out a per-upload endpoint; it is not reusable across uploads.
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $auth['apiUrl'] . '/b2api/v2/b2_get_upload_url?bucketId=' . urlencode($auth['bucketId']),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: ' . $auth['token']],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 30,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch) ?: null;
    if ($err) return ['ok' => false, 'error' => 'B2 upload-url request failed: ' . $err];
    $u = $raw !== false ? json_decode($raw, true) : null;
    if ($code < 200 || $code >= 300 || empty($u['uploadUrl']) || empty($u['authorizationToken'])) {
        return ['ok' => false, 'error' => 'B2 upload-url returned HTTP ' . $code . b2Detail($u, $raw)];
    }

    $body = file_get_contents($path);
    if ($body === false) return ['ok' => false, 'error' => 'could not read local backup file'];

    $prefix = defined('B2_FOLDER') && B2_FOLDER !== '' ? trim(B2_FOLDER, '/') . '/' : '';
    // B2 versions files rather than overwriting, so re-uploading a name never
    // destroys the earlier copy — the point of an off-site copy is that a bad
    // run can't eat it.
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $u['uploadUrl'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Authorization: ' . $u['authorizationToken'],
            // rawurlencode would escape the slashes that make B2 show these as
            // folders, so encode each path segment and keep the separators.
            'X-Bz-File-Name: ' . implode('/', array_map('rawurlencode', explode('/', $prefix . ($remoteName ?? basename($path))))),
            'Content-Type: application/octet-stream',
            'Content-Length: ' . strlen($body),
            // B2 verifies this and rejects a corrupted upload, which is exactly
            // what you want for a backup you will never look at until you must.
            'X-Bz-Content-Sha1: ' . sha1($body),
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT => 120, // whole-file upload, not just a handshake
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch) ?: null;
    if ($err) return ['ok' => false, 'error' => 'B2 upload failed: ' . $err];
    if ($code < 200 || $code >= 300) {
        return ['ok' => false, 'error' => 'B2 upload returned HTTP ' . $code . b2Detail(json_decode((string)$raw, true), $raw)];
    }
    return ['ok' => true, 'error' => null];
}

// Uploads and records the outcome in kv, so a silently-dead uploader is
// visible in Admin Panel → Backups instead of being discovered during a
// disaster. This matters more than the upload itself: nobody watches a cron,
// and "automated but quietly broken for three months" is worse than manual.
// Never throws — an off-site failure must not fail the local backup.
// ── UPLOADS MIRROR (#42a) ─────────────────────────────────────────────────
// The image library was in no backup at all: the DB dump carries the imagerepo
// links, not the files behind them.
//
// Mirrored rather than bundled. Images are append-only (nothing in the app
// deletes an upload), so putting them in each 6-hourly snapshot would store the
// whole library ~240 times over — on the same disk as the originals, where a
// dead disk takes both. Each file is uploaded to B2 exactly once instead:
// ~1x storage, and it lives somewhere the server dying doesn't reach.
//
// The manifest is a plain newline-delimited file of already-sent paths, next to
// the backups. Losing it costs a re-upload, not data — B2 versions rather than
// overwrites, so re-sending a name can never destroy the copy already there.
// GK_UPLOADS_SYNC_CAP is defined above the switch — it's a default argument
// value, so it has to exist before uploadsPending() is ever called.

// Which files still need sending. Pure (filesystem in, list out) so the walk,
// the manifest filter and the cap are all checkable without B2 credentials.
// ponytail: cap per run, so one cron tick can't hit max_execution_time on a
// first sync of a large library — the rest simply go on the next run. Raise it
// (or move to a queue) only if a backlog ever fails to drain.
function uploadsPending($root, array $done, $cap = GK_UPLOADS_SYNC_CAP) {
    if (!is_dir($root)) return [];
    $out = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $f) {
        if (!$f->isFile()) continue;
        $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($root))), '/');
        // .htaccess (written by ensureUploadsDir) is config, not content, and
        // restoring it is ensureUploadsDir's job on the new server.
        if ($rel === '' || basename($rel) === '.htaccess') continue;
        if (isset($done[$rel])) continue;
        $out[] = $rel;
    }
    // Sort BEFORE capping, not after. Capping first takes an arbitrary
    // filesystem-ordered subset and merely sorts that, so which images go up
    // on a given run would vary by host — and a backlog would drain in an
    // order nobody can predict or resume reasoning about. The full walk is
    // cheap next to the uploads themselves.
    sort($out);
    return $cap === PHP_INT_MAX ? $out : array_slice($out, 0, $cap);
}

function uploadsManifestPath() { return ensureBackupsDir() . '/.uploads_synced'; }

function uploadsManifestRead() {
    $p = uploadsManifestPath();
    if (!is_file($p)) return [];
    $lines = preg_split('/\r?\n/', (string)file_get_contents($p));
    return array_flip(array_filter(array_map('trim', $lines), fn($l) => $l !== ''));
}

// Mirrors any not-yet-sent uploads to B2. Never throws: like offsiteSync, a
// file-copy problem must not be able to fail the database backup that called it.
function uploadsSync($pdo) {
    if (!offsiteConfigured()) return ['configured' => false];
    $status = ['configured' => true, 'ok' => true, 'at' => gmdate('c'), 'uploaded' => 0, 'pending' => 0, 'error' => null];
    try {
        $root = rtrim(GK_UPLOADS_DIR, '/');
        $done = uploadsManifestRead();
        $todo = uploadsPending($root, $done);
        foreach ($todo as $rel) {
            $res = offsiteUpload($root . '/' . $rel, 'uploads/' . $rel);
            if (!$res['ok']) { $status['ok'] = false; $status['error'] = $res['error']; break; }
            // Append per file, not once at the end: a run that dies halfway
            // (timeout, disk, network) must not re-send everything next time.
            file_put_contents(uploadsManifestPath(), $rel . "\n", FILE_APPEND | LOCK_EX);
            $status['uploaded']++;
        }
        // Anything still outstanding after the cap, so a backlog is visible
        // rather than looking like a finished sync.
        $status['pending'] = count(uploadsPending($root, uploadsManifestRead(), PHP_INT_MAX));
    } catch (Throwable $e) {
        $status['ok'] = false;
        $status['error'] = $e->getMessage();
    }
    try { kvSet($pdo, 'backupUploads', $status); } catch (Throwable $e) { error_log('GK uploads status write failed: ' . $e->getMessage()); }
    if (!$status['ok']) error_log('GK uploads mirror FAILED: ' . $status['error']);
    return $status;
}

function offsiteSync($pdo, $file) {
    if (!offsiteConfigured()) return ['configured' => false];
    $path = ensureBackupsDir() . '/' . $file;
    try {
        $res = offsiteUpload($path);
    } catch (Throwable $e) {
        $res = ['ok' => false, 'error' => $e->getMessage()];
    }
    $status = [
        'configured' => true,
        'ok' => $res['ok'],
        'at' => gmdate('c'),
        'file' => $file,
        'error' => $res['ok'] ? null : $res['error'],
        'destination' => 'Backblaze B2',
    ];
    // Best-effort: if even recording the status fails, the backup still stands.
    try { kvSet($pdo, 'backupOffsite', $status); } catch (Throwable $e) { error_log('GK offsite status write failed: ' . $e->getMessage()); }
    if (!$res['ok']) error_log('GK off-site backup FAILED for ' . $file . ': ' . $res['error']);
    return $status;
}

// For the callers where a backup is the safety net for something destructive
// (explicit backup, pre-restore snapshot, pre-deploy snapshot): if it can't be
// written, say so and stop rather than proceeding without one.
function runBackupOrFail($pdo) {
    try {
        return runBackup($pdo);
    } catch (Exception $e) {
        respond(500, ['error' => $e->getMessage() . ' Check that the backups/ directory is writable and the disk has free space.']);
    }
}

// ── #13 RELEASE ROLLBACK ──────────────────────────────────────────────────
// No git involved: cPanel's deploy only ever redeploys the checked-out
// branch HEAD, so rollback restores files from a local snapshot instead.
// api.php itself is NOT snapshotted (see snapshotCurrentBuild) — builds
// rarely change it, and copying a running script over itself invites
// confusion for no real benefit at this scale.
// ponytail: if a rollback ever needs to revert an api.php change too, add
// it to the snapshot/restore file list below; until then a bad api.php
// change is fixed by deploying forward, not by rolling back.

function ensureReleasesDir() {
    $dir = GK_RELEASES_DIR;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $htaccess = $dir . '/.htaccess';
    if (!file_exists($htaccess)) {
        file_put_contents($htaccess, "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Deny from all\n</IfModule>\n");
    }
    return $dir;
}

function recurseCopy($src, $dst) {
    if (!is_dir($src)) return;
    if (!is_dir($dst)) mkdir($dst, 0755, true);
    $dir = opendir($src);
    while (($file = readdir($dir)) !== false) {
        if ($file === '.' || $file === '..') continue;
        $srcPath = $src . '/' . $file;
        $dstPath = $dst . '/' . $file;
        if (is_dir($srcPath)) recurseCopy($srcPath, $dstPath);
        else copy($srcPath, $dstPath);
    }
    closedir($dir);
}

function recurseDelete($dir) {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_dir($path)) recurseDelete($path); else @unlink($path);
    }
    @rmdir($dir);
}

function currentVersionInfo() {
    $path = __DIR__ . '/VERSION';
    if (is_file($path)) {
        $v = json_decode(file_get_contents($path), true);
        if (is_array($v)) return $v;
    }
    return ['version' => 'dev', 'commit' => '', 'date' => ''];
}

// Snapshots the CURRENTLY deployed build (index.html, assets/, VERSION —
// not config.php/uploads/backups/api.php) into gk_releases/<version>-<commit>/,
// then prunes to the newest 5. No-ops if nothing's deployed yet (pre-#13
// installs, or the very first deploy) or if this exact build was already
// snapshotted (e.g. two admin_deploy clicks with no new release between).
function snapshotCurrentBuild() {
    $srcRoot = __DIR__;
    if (!is_file($srcRoot . '/index.html')) return null;
    $info = currentVersionInfo();
    $version = $info['version'] ?? 'dev';
    $commit = substr((string)($info['commit'] ?? ''), 0, 12) ?: 'unknown';
    $name = preg_replace('/[^a-zA-Z0-9._-]/', '_', $version . '-' . $commit);
    $releasesDir = ensureReleasesDir();
    $dest = $releasesDir . '/' . $name;
    if (is_dir($dest)) return $name;
    mkdir($dest, 0755, true);
    if (is_file($srcRoot . '/index.html')) copy($srcRoot . '/index.html', $dest . '/index.html');
    if (is_file($srcRoot . '/VERSION')) copy($srcRoot . '/VERSION', $dest . '/VERSION');
    if (is_dir($srcRoot . '/assets')) recurseCopy($srcRoot . '/assets', $dest . '/assets');
    $entries = glob($releasesDir . '/*', GLOB_ONLYDIR);
    usort($entries, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach (array_slice($entries, 5) as $old) recurseDelete($old);
    return $name;
}

function listReleases() {
    $dir = ensureReleasesDir();
    $out = [];
    foreach (glob($dir . '/*', GLOB_ONLYDIR) as $d) {
        $info = ['version' => 'dev', 'commit' => '', 'date' => ''];
        if (is_file($d . '/VERSION')) {
            $v = json_decode(file_get_contents($d . '/VERSION'), true);
            if (is_array($v)) $info = array_merge($info, $v);
        }
        $out[] = [
            'name' => basename($d), 'version' => $info['version'], 'commit' => $info['commit'],
            'date' => $info['date'], 'snapshotAt' => date('c', filemtime($d)),
        ];
    }
    usort($out, fn($a, $b) => strcmp($b['snapshotAt'], $a['snapshotAt']));
    return $out;
}

// Copies a snapshot's files back over the live build. $name is validated
// against the actual snapshot-directory listing (not user-controlled path
// concatenation), so path traversal isn't possible even before basename()
// upstream in the request handler.
function rollbackToRelease($name) {
    $dir = ensureReleasesDir();
    $valid = array_map('basename', glob($dir . '/*', GLOB_ONLYDIR));
    if (!in_array($name, $valid, true)) throw new Exception('Unknown release snapshot.');
    $src = $dir . '/' . $name;
    $destRoot = __DIR__;
    if (is_file($src . '/index.html')) copy($src . '/index.html', $destRoot . '/index.html');
    if (is_file($src . '/VERSION')) copy($src . '/VERSION', $destRoot . '/VERSION');
    if (is_dir($src . '/assets')) {
        recurseDelete($destRoot . '/assets');
        recurseCopy($src . '/assets', $destRoot . '/assets');
    }
}

function restoreFromBackupData($pdo, $data) {
    global $GK_RECORD_TABLES, $GK_CHAT_TABLES, $GK_PLAIN_TABLES;
    ensureRecordTables($pdo); // must exist before the DELETE/INSERT below
    ensureChatTables($pdo);
    ensureLoginSessionsTable($pdo);
    $pdo->beginTransaction();
    try {
        $pdo->exec("DELETE FROM kv_store");
        $stmt = $pdo->prepare("INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, ?)");
        foreach (($data['kv'] ?? []) as $row) {
            $stmt->execute([$row['k'], $row['v'], $row['updated_at'] ?? gmdate('Y-m-d H:i:s')]);
        }
        $pdo->exec("DELETE FROM users");
        $stmt = $pdo->prepare("INSERT INTO users (id, name, pin_hash, role, created_at) VALUES (?, ?, ?, ?, ?)");
        foreach (($data['users'] ?? []) as $row) {
            $stmt->execute([$row['id'], $row['name'], $row['pin_hash'], $row['role'], $row['created_at'] ?? gmdate('Y-m-d H:i:s')]);
        }
        $pdo->exec("DELETE FROM revisions");
        $stmt = $pdo->prepare("INSERT INTO revisions (id, sop_id, snapshot, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)");
        foreach (($data['revisions'] ?? []) as $row) {
            $stmt->execute([$row['id'], $row['sop_id'], $row['snapshot'], $row['saved_at'], $row['saved_by']]);
        }
        // Per-record tables (#41). A backup taken BEFORE the migration has no
        // 'records' key at all — the tables are still emptied, which is correct:
        // that snapshot's data lives in its kv rows, restored above.
        foreach (array_keys($GK_RECORD_TABLES) as $table) {
            $pdo->exec("DELETE FROM $table");
            $rows = $data['records'][$table] ?? [];
            if (!$rows) continue;
            // Column list comes from the row itself, so a schema that gains a
            // column doesn't need this function edited too.
            $cols = array_keys($rows[0]);
            $stmt = $pdo->prepare(
                "INSERT INTO $table (" . implode(', ', $cols) . ")
                 VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")"
            );
            foreach ($rows as $row) {
                $stmt->execute(array_map(fn($c) => $row[$c] ?? null, $cols));
            }
        }

        // Chat. Deleted in reverse order (messages, members, channels) so the
        // rows never outlive the channel they belong to, then reinserted in
        // declaration order. Column list comes from the row, which means
        // chat_messages.id is written EXPLICITLY rather than left to
        // AUTO_INCREMENT — required, because chat_members.last_read_msg_id
        // points at those ids and renumbering would silently mark whole
        // channels unread (or read).
        //
        // A pre-chat-backup dump has no 'chat' key: the tables are still
        // emptied, which is correct — that snapshot predates the messages, and
        // leaving them behind would attach live chat rows to a restored,
        // different-era user and channel set.
        foreach (array_reverse($GK_CHAT_TABLES) as $table) $pdo->exec("DELETE FROM $table");
        foreach ($GK_CHAT_TABLES as $table) {
            $rows = $data['chat'][$table] ?? [];
            if (!$rows) continue;
            $cols = array_keys($rows[0]);
            $stmt = $pdo->prepare(
                "INSERT INTO $table (" . implode(', ', $cols) . ")
                 VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")"
            );
            foreach ($rows as $row) {
                $stmt->execute(array_map(fn($c) => $row[$c] ?? null, $cols));
            }
        }

        // Plain tables. Unlike chat above, a section the dump DOESN'T carry is
        // left alone rather than emptied — that's what lets an older format-2
        // dump (taken before login_sessions was covered) restore without
        // destroying login history it simply never captured, and is why adding
        // this needed no format bump. An explicitly empty section still clears,
        // so a genuine "no sessions" snapshot restores faithfully.
        foreach ($GK_PLAIN_TABLES as $table) {
            if (!isset($data['tables'][$table])) continue;
            $pdo->exec("DELETE FROM $table");
            $rows = $data['tables'][$table];
            if (!$rows) continue;
            $cols = array_keys($rows[0]);
            $stmt = $pdo->prepare(
                "INSERT INTO $table (" . implode(', ', $cols) . ")
                 VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")"
            );
            foreach ($rows as $row) {
                $stmt->execute(array_map(fn($c) => $row[$c] ?? null, $cols));
            }
        }

        // The restored user set may not match who's currently logged in —
        // clear all tokens so everyone gets a clean re-login post-restore.
        $pdo->exec("DELETE FROM tokens");
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        respond(500, ['error' => 'Restore failed: ' . $e->getMessage()]);
    }
}
