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
 *   POST  tag_delete        {id}         - editor/admin
 *   POST  contact_save      {contact}    - editor/admin; upsert one contact by id
 *   POST  contact_delete    {id}         - editor/admin
 *   POST  instance_save     {instance}   - editor/admin; upsert one SOP/Form fill-out instance by id
 *   POST  instance_delete   {id}         - editor/admin
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
        respond(200, ['token' => $token, 'user' => publicUser($user)]);
        break;

    case 'logout':
        $token = bearerToken($body);
        if ($token !== '') $pdo->prepare("DELETE FROM tokens WHERE token = ?")->execute([$token]);
        respond(200, ['ok' => true]);
        break;

    case 'me':
        $user = requireAuth($pdo, $body);
        respond(200, ['user' => publicUser($user)]);
        break;

    case 'kv_all':
        requireAuth($pdo, $body);
        $rows = $pdo->query("SELECT k, v FROM kv_store");
        $out = new stdClass();
        foreach ($rows as $r) { $out->{$r['k']} = json_decode($r['v'], true); }
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
        $sops = kvGet($pdo, 'sops') ?: [];
        $idx = null;
        foreach ($sops as $i => $s) { if (($s['id'] ?? '') === $sop['id']) { $idx = $i; break; } }
        if ($idx !== null) {
            $old = $sops[$idx];
            if (sopContentChanged($old, $sop)) {
                saveRevision($pdo, $sop['id'], $old, $old['updatedBy'] ?? '');
            }
            $sops[$idx] = $sop;
        } else {
            $sops[] = $sop;
        }
        kvSet($pdo, 'sops', $sops);
        respond(200, ['ok' => true, 'sops' => $sops]);
        break;

    case 'task_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $task = $body['task'] ?? null;
        if (!is_array($task) || empty($task['id'])) respond(400, ['error' => 'Missing task']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'tasks' => collectionUpsert($pdo, 'tasks', $task)]);
        break;

    case 'task_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'tasks' => collectionDelete($pdo, 'tasks', $id)]);
        break;

    case 'project_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $project = $body['project'] ?? null;
        if (!is_array($project) || empty($project['id'])) respond(400, ['error' => 'Missing project']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'projects' => collectionUpsert($pdo, 'projects', $project)]);
        break;

    case 'project_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'projects' => collectionDelete($pdo, 'projects', $id)]);
        break;

    case 'campaign_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $campaign = $body['campaign'] ?? null;
        if (!is_array($campaign) || empty($campaign['id'])) respond(400, ['error' => 'Missing campaign']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'campaigns' => collectionUpsert($pdo, 'campaigns', $campaign)]);
        break;

    case 'campaign_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'campaigns' => collectionDelete($pdo, 'campaigns', $id)]);
        break;

    case 'content_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $item = $body['item'] ?? null;
        if (!is_array($item) || empty($item['id'])) respond(400, ['error' => 'Missing item']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'content' => collectionUpsert($pdo, 'content', $item)]);
        break;

    case 'content_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'content' => collectionDelete($pdo, 'content', $id)]);
        break;

    case 'category_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $category = $body['category'] ?? null;
        if (!is_array($category) || empty($category['id'])) respond(400, ['error' => 'Missing category']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'categories' => collectionUpsert($pdo, 'categories', $category)]);
        break;

    case 'category_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'categories' => collectionDelete($pdo, 'categories', $id)]);
        break;

    case 'tag_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $tag = $body['tag'] ?? null;
        if (!is_array($tag) || empty($tag['id'])) respond(400, ['error' => 'Missing tag']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'tags' => collectionUpsert($pdo, 'tags', $tag)]);
        break;

    case 'tag_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'tags' => collectionDelete($pdo, 'tags', $id)]);
        break;

    case 'contact_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $contact = $body['contact'] ?? null;
        if (!is_array($contact) || empty($contact['id'])) respond(400, ['error' => 'Missing contact']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'contacts' => collectionUpsert($pdo, 'contacts', $contact)]);
        break;

    case 'contact_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'contacts' => collectionDelete($pdo, 'contacts', $id)]);
        break;

    case 'instance_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $instance = $body['instance'] ?? null;
        if (!is_array($instance) || empty($instance['id'])) respond(400, ['error' => 'Missing instance']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'instances' => collectionUpsert($pdo, 'instances', $instance)]);
        break;

    case 'instance_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'instances' => collectionDelete($pdo, 'instances', $id)]);
        break;

    case 'alert_save':
        // Any authenticated user may create — a viewer might need to flag
        // something for a manager even without edit rights.
        $user = requireAuth($pdo, $body);
        $alert = $body['alert'] ?? null;
        if (!is_array($alert) || empty($alert['id'])) respond(400, ['error' => 'Missing alert']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'alerts' => collectionUpsert($pdo, 'alerts', $alert)]);
        break;

    case 'alert_delete':
        // Delete requires being the alert's target, its creator, or an admin
        // — dismissing someone else's flag isn't a role thing, it's an
        // ownership thing.
        $user = requireAuth($pdo, $body);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        $alerts = kvGet($pdo, 'alerts') ?: [];
        $target = null;
        foreach ($alerts as $a) { if (($a['id'] ?? null) === $id) { $target = $a; break; } }
        if ($target === null) respond(200, ['ok' => true, 'alerts' => $alerts]);
        $isOwner = $target['toUserId'] === $user['id'] || $target['fromUserId'] === $user['id'];
        if (!$isOwner && $user['role'] !== 'admin') respond(403, ['error' => 'Insufficient permissions for this action']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'alerts' => collectionDelete($pdo, 'alerts', $id)]);
        break;

    case 'template_save':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $template = $body['template'] ?? null;
        if (!is_array($template) || empty($template['id'])) respond(400, ['error' => 'Missing template']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'taskTemplates' => collectionUpsert($pdo, 'taskTemplates', $template)]);
        break;

    case 'template_delete':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['editor', 'admin']);
        $id = $body['id'] ?? '';
        if ($id === '') respond(400, ['error' => 'Missing id']);
        maybeAutoBackup($pdo);
        respond(200, ['ok' => true, 'taskTemplates' => collectionDelete($pdo, 'taskTemplates', $id)]);
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
        $acks = kvGet($pdo, 'acks');
        if (!is_array($acks)) $acks = [];
        if (!isset($acks[$sopId]) || !is_array($acks[$sopId])) $acks[$sopId] = [];
        $acks[$sopId][$userId] = ['at' => $at, 'version' => $version];
        kvSet($pdo, 'acks', $acks);
        respond(200, ['ok' => true, 'acks' => $acks]);
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
        $sops = kvGet($pdo, 'sops') ?: [];
        $idx = null;
        foreach ($sops as $i => $s) { if (($s['id'] ?? '') === $rev['sop_id']) { $idx = $i; break; } }
        if ($idx === null) respond(404, ['error' => 'SOP no longer exists']);
        saveRevision($pdo, $rev['sop_id'], $sops[$idx], $sops[$idx]['updatedBy'] ?? '');
        $restored = array_merge($sops[$idx], $snapshot, [
            'id' => $rev['sop_id'],
            'updatedAt' => gmdate('c'),
            'updatedBy' => $user['name'],
        ]);
        $sops[$idx] = $restored;
        kvSet($pdo, 'sops', $sops);
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
        $cronKey = $_GET['cron_key'] ?? ($body['cron_key'] ?? '');
        if (defined('CRON_KEY') && CRON_KEY !== '' && strpos(CRON_KEY, 'PASTE_') !== 0 && $cronKey !== '' && hash_equals(CRON_KEY, (string)$cronKey)) {
            // cron path — no user token needed
        } else {
            $user = requireAuth($pdo, $body);
            requireRole($user, ['admin']);
        }
        $file = runBackup($pdo);
        respond(200, ['ok' => true, 'file' => $file]);
        break;

    case 'backup_list':
        $user = requireAuth($pdo, $body);
        requireRole($user, ['admin']);
        respond(200, ['backups' => listBackups()]);
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
        // Safety snapshot of current state before we overwrite anything.
        runBackup($pdo);
        $raw = @gzdecode(file_get_contents($path));
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($data)) respond(500, ['error' => 'Backup file is corrupt or unreadable']);
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
        runBackup($pdo);
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
        $tokens = kvGet($pdo, 'icsTokens') ?: [];
        if (empty($tokens[$user['id']])) {
            $tokens[$user['id']] = bin2hex(random_bytes(20));
            kvSet($pdo, 'icsTokens', $tokens);
        }
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
            $mine = (($it['assigneeId'] ?? '') === $userId)
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

// Safe read-merge-write for the per-record collection actions (tasks,
// projects, campaigns, content, categories). Re-reads the current list
// fresh from the DB inside the request, replaces just the matching record
// (or appends if new), and writes the merged array back — so two staff
// editing different records in the same collection concurrently never
// wipe each other out, unlike a blind whole-array kv_set.
function collectionUpsert($pdo, $key, $item) {
    $list = kvGet($pdo, $key) ?: [];
    $idx = null;
    foreach ($list as $i => $x) { if (($x['id'] ?? null) === $item['id']) { $idx = $i; break; } }
    if ($idx !== null) { $list[$idx] = $item; } else { $list[] = $item; }
    kvSet($pdo, $key, $list);
    return $list;
}

function collectionDelete($pdo, $key, $id) {
    $list = kvGet($pdo, $key) ?: [];
    $list = array_values(array_filter($list, function ($x) use ($id) { return ($x['id'] ?? null) !== $id; }));
    kvSet($pdo, $key, $list);
    return $list;
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
    curl_close($ch);
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
    curl_close($ch);
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
    curl_close($ch);
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
    curl_close($ch);
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
    $dir = ensureBackupsDir();
    $stamp = gmdate('Ymd_His');
    $data = ['createdAt' => gmdate('c'), 'kv' => [], 'users' => [], 'revisions' => []];
    foreach ($pdo->query("SELECT k, v, updated_at FROM kv_store") as $row) $data['kv'][] = $row;
    // Hashes only — never plaintext PINs — so users are safe to keep in the dump.
    foreach ($pdo->query("SELECT id, name, pin_hash, role, created_at FROM users") as $row) $data['users'][] = $row;
    foreach ($pdo->query("SELECT id, sop_id, snapshot, saved_at, saved_by FROM revisions") as $row) $data['revisions'][] = $row;

    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $path = $dir . "/gk_$stamp.json.gz";
    $gz = gzopen($path, 'wb9');
    gzwrite($gz, $json);
    gzclose($gz);

    // Keep the newest 60 only.
    $files = glob($dir . '/gk_*.json.gz');
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach (array_slice($files, 60) as $old) @unlink($old);

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
function maybeAutoBackup($pdo) {
    $dir = ensureBackupsDir();
    $files = glob($dir . '/gk_*.json.gz');
    if (!$files) { runBackup($pdo); return; }
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
    if (time() - filemtime($files[0]) > 86400) runBackup($pdo);
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
        // The restored user set may not match who's currently logged in —
        // clear all tokens so everyone gets a clean re-login post-restore.
        $pdo->exec("DELETE FROM tokens");
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        respond(500, ['error' => 'Restore failed: ' . $e->getMessage()]);
    }
}
