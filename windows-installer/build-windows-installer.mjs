import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(__dirname, 'src');
const CACHE_DIR = path.join(__dirname, '.cache');
const STAGING_DIR = path.join(__dirname, '.staging');
const OUTPUT_DIR = path.join(__dirname, 'output');

const NODE_VERSION = 'v22.21.1';
const NODE_WIN_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
const NODE_SHASUMS_URL = `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`;
const CACHED_NODE_EXE = path.join(CACHE_DIR, `node-${NODE_VERSION}-win-x64.exe`);

async function ensureWindowsNodeBinary() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CACHED_NODE_EXE) && fs.statSync(CACHED_NODE_EXE).size > 20_000_000) {
    console.log(`[1/5] Runtime Windows Node.js ${NODE_VERSION} déjà en cache.`);
    return CACHED_NODE_EXE;
  }

  console.log(`[1/5] Téléchargement officiel de Node.js ${NODE_VERSION} (win-x64)...`);
  const [shaRes, binRes] = await Promise.all([fetch(NODE_SHASUMS_URL), fetch(NODE_WIN_URL)]);
  if (!shaRes.ok) throw new Error(`Échec téléchargement SHASUMS256.txt (${shaRes.status})`);
  if (!binRes.ok) throw new Error(`Échec téléchargement node.exe (${binRes.status})`);

  const shaText = await shaRes.text();
  const shaLine = shaText
    .split('\n')
    .find((l) => l.trim().endsWith('win-x64/node.exe'));
  if (!shaLine) throw new Error('Empreinte SHA-256 introuvable pour win-x64/node.exe');
  const expectedSha = shaLine.trim().split(/\s+/)[0].toLowerCase();

  const buf = Buffer.from(await binRes.arrayBuffer());
  const actualSha = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  if (actualSha !== expectedSha) {
    throw new Error(`Vérification SHA-256 échouée (${actualSha} != ${expectedSha})`);
  }

  fs.writeFileSync(CACHED_NODE_EXE, buf);
  console.log(`[OK] Node.js ${NODE_VERSION} vérifié (${(buf.length / 1024 / 1024).toFixed(1)} Mo, SHA-256 OK).`);
  return CACHED_NODE_EXE;
}

function findPackageDir(pkgName, fromDir) {
  let cursor = fromDir;
  while (true) {
    const candidate = path.join(cursor, 'node_modules', pkgName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor || !cursor.startsWith(ROOT_DIR)) break;
    cursor = parent;
  }
  const rootCandidate = path.join(ROOT_DIR, 'node_modules', pkgName);
  return fs.existsSync(path.join(rootCandidate, 'package.json')) ? rootCandidate : null;
}

function copyRuntimeNodeModules(entryPackages, targetNodeModulesDir) {
  const visited = new Set();
  const queue = entryPackages.map((name) => ({ name, fromDir: ROOT_DIR }));

  while (queue.length > 0) {
    const { name, fromDir } = queue.shift();
    const pkgDir = findPackageDir(name, fromDir);
    if (!pkgDir) {
      throw new Error(`Dépendance runtime manquante dans node_modules : ${name}`);
    }
    const realPkgDir = fs.realpathSync(pkgDir);
    if (visited.has(realPkgDir)) continue;
    visited.add(realPkgDir);

    // Preserve scoped/nested structure cleanly
    const relFromRootNm = path.relative(path.join(ROOT_DIR, 'node_modules'), pkgDir);
    const destDir = relFromRootNm.startsWith('..')
      ? path.join(targetNodeModulesDir, name)
      : path.join(targetNodeModulesDir, relFromRootNm);

    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(realPkgDir, destDir, { recursive: true, force: true, dereference: true });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(realPkgDir, 'package.json'), 'utf8'));
    const deps = Object.keys(pkgJson.dependencies || {});
    for (const dep of deps) {
      queue.push({ name: dep, fromDir: realPkgDir });
    }
  }
  return visited.size;
}

function readPublicSupabaseEnvDefaults() {
  const vals = { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' };
  for (const candidate of [path.join(ROOT_DIR, '.env'), path.join(ROOT_DIR, '.env.local')]) {
    if (!fs.existsSync(candidate)) continue;
    const lines = fs.readFileSync(candidate, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v) vals[m[1]] = v;
    }
  }
  return (
    `VITE_SUPABASE_URL="${vals.VITE_SUPABASE_URL.replace(/"/g, '')}"\n` +
    `VITE_SUPABASE_ANON_KEY="${vals.VITE_SUPABASE_ANON_KEY.replace(/"/g, '')}"\n`
  );
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const nodeWinExe = await ensureWindowsNodeBinary();

  console.log('[2/5] Compilation du frontend PWA (npm run build)...');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT_DIR, stdio: 'inherit' });

  console.log('[3/5] Compilation du contrôleur natif Windows SmartMenuQR.exe...');
  const resOut = path.join(SRC_DIR, 'resource.res');
  const managerExe = path.join(OUTPUT_DIR, 'SmartMenuQR.exe');
  execFileSync(
    'x86_64-w64-mingw32-windres',
    [path.join(SRC_DIR, 'resource.rc'), '-O', 'coff', '-o', resOut],
    { cwd: SRC_DIR, stdio: 'inherit' }
  );
  execFileSync(
    'x86_64-w64-mingw32-gcc',
    [
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-static-libgcc',
      '-mwindows',
      '-municode',
      path.join(SRC_DIR, 'smartmenu-manager.c'),
      resOut,
      '-o',
      managerExe,
      '-lws2_32',
      '-liphlpapi',
      '-lwinhttp',
      '-lcomctl32',
      '-lcomdlg32',
      '-lshell32',
      '-lshlwapi',
      '-ladvapi32',
      '-lole32',
    ],
    { cwd: ROOT_DIR, stdio: 'inherit' }
  );

  console.log('[4/5] Préparation des fichiers embarqués (.staging/)...');
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGING_DIR, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(STAGING_DIR, 'app', 'local-server'), { recursive: true });
  fs.mkdirSync(path.join(STAGING_DIR, 'app', 'docs'), { recursive: true });

  fs.copyFileSync(managerExe, path.join(STAGING_DIR, 'SmartMenuQR.exe'));
  fs.copyFileSync(nodeWinExe, path.join(STAGING_DIR, 'runtime', 'node.exe'));
  fs.cpSync(path.join(ROOT_DIR, 'dist'), path.join(STAGING_DIR, 'app', 'dist'), {
    recursive: true,
    force: true,
  });

  for (const f of ['server.mjs', 'sync-cloud.mjs', 'config.example.json']) {
    fs.copyFileSync(
      path.join(ROOT_DIR, 'local-server', f),
      path.join(STAGING_DIR, 'app', 'local-server', f)
    );
  }

  for (const doc of ['GUIDE-INSTALLATION-WINDOWS.md', 'WINDOWS-LOCAL-SERVER.md']) {
    const srcDoc = path.join(ROOT_DIR, 'docs', doc);
    if (fs.existsSync(srcDoc)) {
      fs.copyFileSync(srcDoc, path.join(STAGING_DIR, 'app', 'docs', doc));
    }
  }

  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const runtimePkg = {
    name: 'smartmenu-qr-local-server',
    private: true,
    version: '1.0.0',
    type: 'module',
    scripts: {
      start: 'node local-server/server.mjs',
      sync: 'node local-server/sync-cloud.mjs',
    },
    dependencies: {
      dotenv: rootPkg.dependencies?.dotenv || '^17.2.3',
      express: rootPkg.dependencies?.express || '^4.21.2',
    },
  };
  fs.writeFileSync(
    path.join(STAGING_DIR, 'app', 'package.json'),
    `${JSON.stringify(runtimePkg, null, 2)}\n`,
    'utf8'
  );

  const pkgCount = copyRuntimeNodeModules(
    ['express', 'dotenv'],
    path.join(STAGING_DIR, 'app', 'node_modules')
  );
  console.log(`[OK] ${pkgCount} paquets runtime collectés (express + dotenv).`);

  fs.writeFileSync(path.join(STAGING_DIR, 'env.defaults'), readPublicSupabaseEnvDefaults(), 'utf8');

  console.log('[5/5] Génération de l’installateur Windows SmartMenu-QR-Setup.exe (NSIS)...');
  const setupExe = path.join(OUTPUT_DIR, 'SmartMenu-QR-Setup.exe');
  execFileSync(
    'makensis',
    [
      '-V3',
      `-DOUT_FILE=${setupExe}`,
      `-DSRC_DIR=${SRC_DIR}`,
      `-DSTAGING_DIR=${STAGING_DIR}`,
      path.join(SRC_DIR, 'installer.nsi'),
    ],
    { cwd: ROOT_DIR, stdio: 'inherit' }
  );

  const stat = fs.statSync(setupExe);
  console.log(
    `\n[SUCCÈS] Installateur Windows généré : ${path.relative(ROOT_DIR, setupExe)} (${(
      stat.size /
      1024 /
      1024
    ).toFixed(2)} Mo)`
  );
}

main().catch((err) => {
  console.error('[ERREUR]', err?.message || err);
  process.exit(1);
});
