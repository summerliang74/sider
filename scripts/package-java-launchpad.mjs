import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? new Date().toISOString().replace(/[^0-9]/g, '');
if (!/^[A-Za-z0-9_-]{1,80}$/.test(tag)) throw new Error('Invalid package tag');
const target = path.join(root, '.tmp', 'java-launchpad', tag);
await mkdir(path.dirname(target), { recursive: true });
await mkdir(target, { recursive: false });
await mkdir(path.join(target, 'backend'), { recursive: true });
for (const name of ['pom.xml', 'Dockerfile', '.dockerignore']) await cp(path.join(root, 'backend', name), path.join(target, 'backend', name));
// Only reviewed Java sources/static assets ship; no env files, caches or old Node manifests.
const main = path.join(root, 'backend', 'src', 'main');
async function copyTree(source, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || /\.env(?:\.|$)|\.log$/i.test(entry.name)) throw new Error('Unexpected private file in application sources');
    const from = path.join(source, entry.name), to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await cp(from, to);
    else throw new Error('Source snapshot cannot contain links or special files');
  }
}
await copyTree(main, path.join(target, 'backend', 'src', 'main'));
const plan = JSON.parse(await readFile(path.join(root, '.launchpad', 'deploy.json'), 'utf8'));
if (plan.runtime !== 'dockerfile' || plan.root !== 'backend' || plan.port !== 8080 || plan.releaseCommand) throw new Error('Unexpected Java release plan');
await mkdir(path.join(target, '.launchpad'));
await writeFile(path.join(target, '.launchpad', 'deploy.json'), JSON.stringify(plan, null, 2) + '\n');
console.log(JSON.stringify({ path: target, root: plan.root, runtime: plan.runtime, port: plan.port, published: false }));
