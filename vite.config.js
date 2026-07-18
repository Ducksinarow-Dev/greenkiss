import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));
let commit = 'local';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* no git available */ }
const buildDate = new Date().toISOString().slice(0, 10);

// #v2: baked-in build identity, shown as "Build vX.Y.Z · commit · date" in
// the Sidebar footer (see src/components/Sidebar.jsx) and mirrored into
// dist/VERSION by scripts/release.sh for the api.php `version_info` action.
export default defineConfig({
  plugins: [react()],
  // Honor PORT when the launcher assigns one (falls back to vite's 5173).
  server: { port: Number(process.env.PORT) || 5173 },
  define: {
    __GK_VERSION__: JSON.stringify(pkg.version),
    __GK_COMMIT__: JSON.stringify(commit),
    __GK_BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
