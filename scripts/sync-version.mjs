#!/usr/bin/env node
/**
 * 版本同步脚本
 * 在 npm version 后自动执行，把 package.json 的版本同步到 Cargo.toml 和 latest.json
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// 读取 package.json 的版本
const pkgPath = resolve(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const version = pkg.version;

console.log(`[sync-version] Syncing version ${version} to Cargo.toml...`);

// 更新 Cargo.toml
const cargoPath = resolve(rootDir, 'src-tauri', 'Cargo.toml');
let cargoToml = readFileSync(cargoPath, 'utf-8');

// 使用正则替换 version 行，保留其他内容
cargoToml = cargoToml.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`
);

writeFileSync(cargoPath, cargoToml);
console.log(`[sync-version] ✓ Cargo.toml updated to ${version}`);

// latest.json 是应用内检查更新读取的版本文件，发版时必须跟着动
const latestPath = resolve(rootDir, 'latest.json');
if (existsSync(latestPath)) {
  const latest = JSON.parse(readFileSync(latestPath, 'utf-8'));
  latest.version = version;
  writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  console.log(`[sync-version] ✓ latest.json updated to ${version}`);
}

// Cargo.lock 里也记着本包版本，漏改的话下次 cargo 构建会留下一个脏文件
const lockPath = resolve(rootDir, 'src-tauri', 'Cargo.lock');
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf-8');
  const next = lock.replace(
    /(\[\[package\]\]\nname = "focus-island"\nversion = ")[^"]+(")/,
    `$1${version}$2`
  );
  if (next !== lock) {
    writeFileSync(lockPath, next);
    console.log(`[sync-version] ✓ Cargo.lock updated to ${version}`);
  }
}

// 可选：如果 Tauri 配置没使用 "../package.json"，也可以同步
// 但推荐用 "../package.json" 方式，这样不需要手动改
