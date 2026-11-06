#!/usr/bin/env node
/**
 * Copies the NSIS installer to an ASCII-only filename.
 *
 * productName is "专注岛", so the bundler emits "专注岛_<version>_x64-setup.exe".
 * `gh release upload` silently drops non-ASCII characters from the asset name
 * (v1.1.1 went up as "_1.1.1_x64-setup.exe"), so copy the file first and upload
 * the copy instead. Prints the resulting path on the last line.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));

const bundleDir = resolve(rootDir, 'src-tauri/target/release/bundle/nsis');
const outPath = resolve(rootDir, 'src-tauri/target/release/bundle', `FocusIsland_${version}_x64-setup.exe`);

if (!existsSync(bundleDir)) {
  console.error(`[bundle-release] missing ${bundleDir}\n  build first: npx tauri build --bundles nsis`);
  process.exit(1);
}

// Match whichever prefix the bundler used, so this stays idempotent.
const installer = readdirSync(bundleDir)
  .filter(name => name.endsWith(`_${version}_x64-setup.exe`))
  .sort()
  .pop();

if (!installer) {
  console.error(`[bundle-release] no installer for ${version} in ${bundleDir}`);
  process.exit(1);
}

copyFileSync(resolve(bundleDir, installer), outPath);
console.log(`[bundle-release] ${installer} -> ${outPath}`);
console.log(outPath);
