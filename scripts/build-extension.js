#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const panelDir = path.join(rootDir, 'devtools-panel');

function log(message) {
  process.stdout.write(`${message}\n`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  ensureDir(dest);
  fs.cpSync(src, dest, { recursive: true, filter: (source) => {
    const base = path.basename(source);
    return !base.startsWith('.') && base !== 'node_modules';
  }});
}

(function build() {
  log('Cleaning dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true });

  log('Building DevTools panel via Vite...');
  execSync('npm run build', { cwd: panelDir, stdio: 'inherit' });

  ensureDir(distDir);

  const filesToCopy = [
    'manifest.json',
    'background.js',
    'devtools.html',
    'devtools.js',
    'click-listener.js',
    'results.html',
    'results.js',
  ];

  filesToCopy.forEach((relativePath) => {
    const src = path.join(rootDir, relativePath);
    const dest = path.join(distDir, relativePath);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    }
  });

  const directoriesToCopy = ['background'];
  directoriesToCopy.forEach((relativePath) => {
    const src = path.join(rootDir, relativePath);
    if (fs.existsSync(src)) {
      const dest = path.join(distDir, relativePath);
      copyDir(src, dest);
    }
  });

  log('Extension build complete. Output available in dist/.');
})();
