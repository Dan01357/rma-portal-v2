import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rootOutputFile = path.join(rootDir, 'PROJECT_CONTEXT.txt');
const publicDir = path.join(rootDir, 'public');
const publicOutputFile = path.join(publicDir, 'PROJECT_CONTEXT.txt');
const distDir = path.join(rootDir, 'dist');
const distOutputFile = path.join(distDir, 'PROJECT_CONTEXT.txt');

// 1. Generate directory tree (excluding node_modules, .git, dist, .vercel)
function getDirectoryTree(dir, prefix = '', isLast = true) {
  let output = '';
  const base = path.basename(dir);
  if (prefix === '') {
    output += `${base}/\n`;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !['node_modules', '.git', 'dist', '.vercel', '.gemini'].includes(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  entries.forEach((entry, idx) => {
    const isCurrentLast = idx === entries.length - 1;
    const connector = isCurrentLast ? '└── ' : '├── ';
    const subPrefix = prefix + (isLast && prefix !== '' ? '    ' : (prefix === '' ? '' : '│   '));

    if (entry.isDirectory()) {
      output += `${subPrefix}${connector}${entry.name}/\n`;
      output += getDirectoryTree(path.join(dir, entry.name), subPrefix + (isCurrentLast ? '    ' : '│   '), isCurrentLast);
    } else {
      output += `${subPrefix}${connector}${entry.name}\n`;
    }
  });

  return output;
}

// 2. Read package.json dependencies
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

// 3. Helper to format a file cleanly
function formatFileContent(relPath) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    return '';
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const displayPath = relPath.replace(/\\/g, '/');
  return `\n--- START FILE: ${displayPath} ---\n${content}\n--- END FILE: ${displayPath} ---\n`;
}

// Recursively find all target files in a folder
function getAllFilesInDir(dir, filterExt = ['.js', '.jsx', '.json', '.ts', '.css', '.sql', '.md', '.html']) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', '.vercel', '.gemini', 'archive_v1'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllFilesInDir(full, filterExt));
    } else if (filterExt.some(ext => entry.name.endsWith(ext))) {
      results.push(path.relative(rootDir, full));
    }
  }
  return results;
}

console.log('[build_context] Generating full directory tree...');
const tree = getDirectoryTree(rootDir);

let contextContent = '';
contextContent += '================================================================================\n';
contextContent += 'WHOLESALE RMA PORTAL V2 - CONSOLIDATED PROJECT CONTEXT\n';
contextContent += `Generated At: ${new Date().toISOString()}\n`;
contextContent += `Application Version: ${pkg.version}\n`;
contextContent += '================================================================================\n\n';

contextContent += '================================================================================\n';
contextContent += '1. DIRECTORY TREE / FILE STRUCTURE\n';
contextContent += '================================================================================\n\n';
contextContent += tree;
contextContent += '\n';

contextContent += '================================================================================\n';
contextContent += '2. PACKAGE.JSON & DEPENDENCIES\n';
contextContent += '================================================================================\n\n';
contextContent += JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  dependencies: pkg.dependencies,
  devDependencies: pkg.devDependencies
}, null, 2);
contextContent += '\n\n';

contextContent += '================================================================================\n';
contextContent += '3. CONSOLIDATED KEY PROJECT FILES\n';
contextContent += '================================================================================\n';

// Collect all relevant files
const apiFiles = getAllFilesInDir(path.join(rootDir, 'api'));
const srcFiles = getAllFilesInDir(path.join(rootDir, 'src'));
const docFiles = getAllFilesInDir(path.join(rootDir, 'docs'));
const rootConfigAndSqlFiles = fs.readdirSync(rootDir)
  .filter(f => f.endsWith('.sql') || f.endsWith('.md') || f === 'vercel.json' || f === 'vite.config.js' || f === 'tailwind.config.js' || f === 'index.html')
  .filter(f => f !== 'PROJECT_CONTEXT.txt');

const allTargetFiles = [
  ...rootConfigAndSqlFiles,
  ...docFiles,
  ...apiFiles,
  ...srcFiles
];

const uniqueFiles = Array.from(new Set(allTargetFiles));
console.log(`[build_context] Embedding ${uniqueFiles.length} project files...`);

for (const relFile of uniqueFiles) {
  contextContent += formatFileContent(relFile);
}

// Ensure public dir exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Write to root PROJECT_CONTEXT.txt
fs.writeFileSync(rootOutputFile, contextContent, 'utf-8');

// 2. Write to public/PROJECT_CONTEXT.txt (for Vite static serving)
fs.writeFileSync(publicOutputFile, contextContent, 'utf-8');

// 3. Write to dist/PROJECT_CONTEXT.txt if dist exists
if (fs.existsSync(distDir)) {
  fs.writeFileSync(distOutputFile, contextContent, 'utf-8');
}

const stats = fs.statSync(rootOutputFile);
console.log(`[build_context] Successfully updated:`);
console.log(` - Root: ${rootOutputFile}`);
console.log(` - Public: ${publicOutputFile}`);
if (fs.existsSync(distDir)) console.log(` - Dist: ${distOutputFile}`);
console.log(`[build_context] File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`);

