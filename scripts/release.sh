#!/usr/bin/env bash
# Publish a build to the `release` branch on GitHub. This does NOT deploy to
# the live site by itself — deploy-on-push is deliberately kept OFF in
# cPanel. Live deploys happen only via Admin Panel -> Software Update ->
# Update Now (an admin's explicit click), or cPanel's own manual Pull or
# Deploy as a fallback. See DEPLOY.md.
#
# Flow: clean-tree guard -> npm version patch (its own commit) -> npm run
# check (eslint + vite build) -> vite build -> stage api.php + VERSION +
# .cpanel.yml into dist/ -> replace the `release` branch contents with
# dist/ (via a temp git worktree) -> push release AND main.
#
# The release branch holds ONLY build output (index.html, assets/, VERSION,
# api.php, .cpanel.yml) — never source. Its history is one commit per release.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="release"
SRC_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ -n "$(git status --porcelain)" ]]; then
  echo "✗ Working tree is dirty. Commit or stash before releasing." >&2
  exit 1
fi

echo "→ bumping patch version"
npm version patch --no-git-tag-version >/dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -q -m "Release: v${NEW_VERSION}"
echo "  v${NEW_VERSION}"

SRC_COMMIT=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +%Y-%m-%d)

echo "→ npm run check"
npm run check

echo "→ vite build"
npm run build

echo "→ staging api.php + VERSION + .cpanel.yml into dist/"
cp api.php dist/api.php
cp .cpanel.yml dist/.cpanel.yml
cat > dist/VERSION <<EOF
{"version":"${NEW_VERSION}","commit":"${SRC_COMMIT}","date":"${BUILD_DATE}"}
EOF

WT=$(mktemp -d /tmp/gk-release.XXXXXX)
cleanup() { git worktree remove --force "$WT" 2>/dev/null || true; rm -rf "$WT"; }
trap cleanup EXIT

echo "→ preparing $BRANCH branch worktree"
git fetch origin "$BRANCH" 2>/dev/null || true
if git show-ref --verify --quiet "refs/heads/$BRANCH" || git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git worktree add "$WT" "$BRANCH" 2>/dev/null || git worktree add -b "$BRANCH" "$WT" "origin/$BRANCH"
  (cd "$WT" && git pull --ff-only origin "$BRANCH" 2>/dev/null || true)
else
  git worktree add --detach "$WT"
  (cd "$WT" && git checkout --orphan "$BRANCH" && git rm -rf --quiet . 2>/dev/null || true)
fi

echo "→ replacing branch contents with dist/"
(cd "$WT" && find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +)
cp -R dist/. "$WT/"

(cd "$WT" \
  && git add -A \
  && if git diff --cached --quiet; then
       echo "✓ No changes since last release — branch already current."
     else
       git commit -m "Release v${NEW_VERSION} (${SRC_COMMIT} on ${SRC_BRANCH})" \
       && git push origin "$BRANCH" \
       && echo "✓ Pushed v${NEW_VERSION} (${SRC_COMMIT}) to origin/${BRANCH}"
     fi)

# Every release gets its own version commit on the source branch too — push
# it so main and the published release branch never drift apart.
echo "→ pushing ${SRC_BRANCH}"
git push origin "$SRC_BRANCH" 2>/dev/null \
  && echo "✓ Pushed ${SRC_BRANCH}" \
  || echo "⚠ Could not push ${SRC_BRANCH} (diverged?) — release IS published; pull --rebase and push ${SRC_BRANCH} manually."

echo ""
echo "Done. Published to origin/${BRANCH} — the live site is unchanged until an admin clicks Admin Panel -> Software Update -> Update Now (or uses cPanel's Manage -> Pull or Deploy manually). See DEPLOY.md."
