import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

// Generate from the modules seen by the bundler, including transitive packages.
// Only the pinned missing upstream licence and PDF asset notices are retained.
export function browserNotices(moduleIds, root) {
  const packages = new Map();
  for (const id of moduleIds) {
    if (id.startsWith('\0') || !id.includes('/node_modules/')) continue;
    let directory = path.dirname(id.split('?')[0]);
    while (directory !== path.dirname(directory)) {
      let pkg;
      try { pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      if (pkg?.name) { packages.set(`${pkg.name}@${pkg.version}`, {pkg, directory}); break; }
      directory = path.dirname(directory);
    }
  }
  const supplemental = readFileSync(path.join(root, 'THIRD_PARTY_JAVASCRIPT_LICENSES.txt'), 'utf8');
  const missingLicense = supplemental.split('\n---\n')[1].trim();
  const sections = ['Third-party JavaScript notices\n\nThese notices apply to the named third-party components, not the application source.'];
  for (const [key, {pkg, directory}] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    if (!['MIT', 'Apache-2.0'].includes(pkg.license)) throw new Error(`Review unexpected licence for ${key}: ${pkg.license}`);
    const file = readdirSync(directory).find(name => /^licen[cs]e(?:\.(?:txt|md))?$/i.test(name));
    if (!file) {
      if (key !== '@nodable/entities@3.1.0' || pkg.license !== 'MIT') throw new Error(`Missing licence text for ${key}`);
      sections.push(missingLicense);
    } else {
      const text = readFileSync(path.join(directory, file), 'utf8').trim();
      if (!text) throw new Error(`Empty licence text for ${key}`);
      sections.push(`${key}\n\n${text}`);
    }
  }
  const vite = JSON.parse(readFileSync(path.join(root, 'node_modules/vite/package.json'), 'utf8'));
  const viteText = readFileSync(path.join(root, 'node_modules/vite/LICENSE.md'), 'utf8').split('# Licenses of bundled dependencies')[0].split('MIT License')[1]?.trim();
  if (vite.license !== 'MIT' || !viteText?.includes('Copyright')) throw new Error('Review Vite runtime licence');
  sections.push(`Vite modulepreload polyfill (vite@${vite.version})\n\nMIT License\n\n${viteText}`);
  // All PDF assets are copied, so retain every shipped asset licence too.
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    const assetRoot = path.join(root, 'node_modules/pdfjs-dist', directory);
    for (const file of readdirSync(assetRoot).filter(name => /^LICENSE/i.test(name)).sort()) {
      sections.push(`pdfjs-dist/${directory}/${file}\n\n${readFileSync(path.join(assetRoot, file), 'utf8').trim()}`);
    }
  }
  return sections.join('\n\n---\n\n').replaceAll('*/', '* /') + '\n';
}
