import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeReturnTo, normalizeTags, validateFiles, declaredMime, validStorageUrl, PageCollection, searchParams } from '../backend/src/main/resources/static/assets/helpers.mjs';
import { UploadQueue, UploadError } from '../backend/src/main/resources/static/assets/upload-queue.mjs';
import { apiPathsForRoute } from '../backend/src/main/resources/static/assets/route-prefetch.mjs';
import { automaticPrefetchAllowed } from '../backend/src/main/resources/static/assets/navigation.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const file = (name = 'notes.pdf') => ({ name, size: 100, type: 'application/pdf' });
const meta = { title: 'Notes', description: '', tags: ['Notes'] };
test('unbundled browser entry parses without a framework build step', async () => {
  const source = await readFile(new URL('../backend/src/main/resources/static/assets/app.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(source.replace(/^import .*$/gm, '')));
});
test('return navigation rejects external, encoded and non-business destinations', () => {
  for (const unsafe of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/resources/%0a', '/api/internal/jobs/uploads', '/dashboard-api/oauth/bootstrap', '/__lp_auth/callback', '/admin/unknown', '/resources/' + 'a'.repeat(501)]) assert.equal(safeReturnTo(unsafe), '/resources', unsafe);
  assert.equal(safeReturnTo('/me/resources?status=scanning#private'), '/me/resources?status=scanning');
  assert.equal(safeReturnTo('/resources/123?source=search'), '/resources/123?source=search');
});
test('PA policy checks aliases before dedup and retains first spelling', () => {
  for (const alias of ['PA', 'ＰＡ', 'peer-advisors', 'Peer Advisor', 'p.a.']) assert.throws(() => normalizeTags(['Notes', alias], false), /administrators/);
  assert.deepEqual(normalizeTags('Notes, notes, ＰＡ, peer-advisors', true), ['Notes', 'PA']);
  assert.throws(() => normalizeTags(['a'.repeat(31)]));
  assert.throws(() => normalizeTags(Array(11).fill('Notes')));
});
test('file preflight handles native empty MIME without trusting a mismatched MIME', () => {
  assert.equal(declaredMime({ name: 'photo.JPG', type: '' }), 'image/jpeg');
  assert.throws(() => declaredMime({ name: 'photo.jpg', type: 'application/pdf' }));
  assert.throws(() => declaredMime({ name: 'document.docm', type: '' }));
  assert.throws(() => validateFiles(Array(6).fill(file()), 100));
  validateFiles([file()], 100);
  assert.throws(() => validateFiles([file()], 99));
});
test('new filter pagination resets data and treats cursors as opaque values', () => {
  const pages = new PageCollection();
  pages.accept({ items: [{ id: 'one' }], nextCursor: 'abc.def' });
  pages.accept({ items: [{ id: 'one' }, { id: 'two' }], nextCursor: null }, true);
  assert.deepEqual(pages.items.map(i => i.id), ['one', 'two']);
  pages.reset(); pages.accept({ items: [{ id: 'three' }], nextCursor: null });
  assert.deepEqual(pages.items.map(i => i.id), ['three']);
  assert.equal(searchParams({ q: ' notes ', type: 'pdf', tag: 'PA' }, 'abc+/=').get('cursor'), 'abc+/=');
  assert.equal(searchParams({ q: ' notes ' }).get('q'), 'notes');
});
test('storage transfers accept only HTTPS and omit same-origin/session endpoints', () => {
  assert.equal(validStorageUrl('https://files.example.test/key?sig=private', 'https://sider.test'), 'https://files.example.test/key?sig=private');
  for (const value of ['javascript:alert(1)', 'http://files.test/key', 'https://user:pass@files.test/key', 'https://sider.test/api/me']) assert.throws(() => validStorageUrl(value, 'https://sider.test'));
});
test('route prefetch loads metadata only and never download or file bodies', () => {
  const base = 'https://siderlearn.com/resources';
  assert.deepEqual(apiPathsForRoute('/resources', base), ['/api/resources/tags', '/api/resources?']);
  assert.deepEqual(apiPathsForRoute('/resources/abc?source=search', base), ['/api/resources/abc']);
  assert.deepEqual(apiPathsForRoute('/me/resources', base), ['/api/me/resources?view=workspace']);
  assert.deepEqual(apiPathsForRoute('/resources/new', base), []);
  assert.deepEqual(apiPathsForRoute('/admin/dashboard', base), ['/api/admin/dashboard?range=7d']);
  assert.deepEqual(apiPathsForRoute('/admin/dashboard?range=30d', base), ['/api/admin/dashboard?range=30d']);
  assert.deepEqual(apiPathsForRoute('/admin/reports', base), ['/api/admin/reports?view=workspace']);
  assert.deepEqual(apiPathsForRoute('/admin/audit', base), ['/api/admin/audit?view=workspace']);
  assert.equal(safeReturnTo('/admin/dashboard?range=24h'), '/admin/dashboard?range=24h');
  assert.deepEqual(apiPathsForRoute('https://evil.test/resources/abc', base), []);
  assert.ok(apiPathsForRoute('/resources/abc', base).every(path => !path.includes('download')));
});
test('automatic prefetch respects visibility, connectivity, data saver and slow networks', () => {
  const visible = { visibilityState: 'visible' };
  assert.equal(automaticPrefetchAllowed({ onLine: true, connection: { effectiveType: '4g' } }, visible), true);
  for (const effectiveType of ['slow-2g', '2g', '3g']) assert.equal(automaticPrefetchAllowed({ onLine: true, connection: { effectiveType } }, visible), false);
  assert.equal(automaticPrefetchAllowed({ onLine: false }, visible), false);
  assert.equal(automaticPrefetchAllowed({ onLine: true, connection: { saveData: true } }, visible), false);
  assert.equal(automaticPrefetchAllowed({ onLine: true }, { visibilityState: 'hidden' }), false);
});
test('native resource links preserve the original idle and intent preload policy', async () => {
  const source = await readFile(new URL('../backend/src/main/resources/static/assets/app.js', import.meta.url), 'utf8');
  assert.match(source, /items\.map\(\(item, index\).*'data-prefetch-intent': true, 'data-prefetch-idle': index < 3/s);
  assert.match(source, /href: '\/resources\/new'.*'data-prefetch-intent': true, 'data-prefetch-idle': true/);
});
test('five uploads run at most two concurrent transfers and one failure does not block others', async () => {
  let active = 0, max = 0, intents = 0, completed = 0;
  const transport = {
    intent: async () => ({ resourceId: String(++intents) }),
    put: async (f, intent, signal, progress) => { active++; max = Math.max(max, active); progress(50); await tick(); active--; if (intent.resourceId === '2') throw new Error('failed file'); },
    complete: async id => { completed++; return { id, status: 'scanning' }; }, cancel: async () => {},
  };
  const queue = new UploadQueue(Array.from({ length: 5 }, () => file()), meta, transport, () => {}); queue.start();
  for (let i = 0; i < 20 && queue.running.size; i++) await tick();
  assert.equal(max, 2); assert.equal(completed, 4); assert.equal(queue.items.filter(i => i.stage === 'error').length, 1);
  assert.equal(queue.items.filter(i => i.stage === 'scanning').length, 4);
});
test('complete retry reuses intent and transferred content', async () => {
  let intents = 0, puts = 0, completes = 0;
  const queue = new UploadQueue([file()], meta, {
    intent: async () => { intents++; return { resourceId: 'one' }; },
    put: async () => { puts++; },
    complete: async id => { if (++completes === 1) throw new Error('network'); return { id, status: 'active' }; }, cancel: async () => {},
  }, () => {});
  queue.start(); await tick(); assert.equal(queue.items[0].stage, 'error'); queue.retry('0'); await tick();
  assert.equal(intents, 1); assert.equal(puts, 1); assert.equal(completes, 2); assert.equal(queue.items[0].stage, 'active');
});
test('unknown create result cannot blindly create a second resource', async () => {
  let intents = 0;
  const queue = new UploadQueue([file()], meta, { intent: async () => { intents++; throw new TypeError('network lost'); } }, () => {});
  queue.start(); await tick(); queue.retry('0'); await tick(); assert.equal(intents, 1); assert.equal(queue.items[0].uncertain, true);
});
test('cancel during intent creation deletes late intent and never uploads it', async () => {
  let resolveIntent, puts = 0; const deleted = [];
  const queue = new UploadQueue([file()], meta, { intent: () => new Promise(resolve => { resolveIntent = resolve; }), put: async () => { puts++; }, cancel: async id => deleted.push(id) }, () => {});
  queue.start(); await queue.cancel('0'); resolveIntent({ resourceId: 'late' }); await tick();
  assert.deepEqual(deleted, ['late']); assert.equal(puts, 0); assert.equal(queue.items[0].stage, 'cancelled');
});
test('status updates never resurrect cancelled or published items', async () => {
  const queue = new UploadQueue([file()], meta, { intent: async () => ({ resourceId: 'one' }), put: async () => {}, complete: async id => ({ id, status: 'scanning' }), cancel: async () => {} }, () => {});
  queue.start(); await tick(); await queue.cancel('0'); queue.updateStatuses([{ id: 'one', status: 'active' }]);
  assert.equal(queue.items[0].stage, 'cancelled');
});
test('failed cancellation of a late intent stays visibly uncertain', async () => {
  let resolveIntent;
  const queue = new UploadQueue([file()], meta, { intent: () => new Promise(resolve => { resolveIntent = resolve; }), cancel: async () => { throw new Error('network'); } }, () => {});
  queue.start(); await queue.cancel('0'); resolveIntent({ resourceId: 'late' }); await tick();
  assert.equal(queue.items[0].stage, 'error'); assert.equal(queue.items[0].uncertain, true); assert.match(queue.items[0].message, /not confirmed/);
});

test('upload challenges release slots and resume only the verified file', async () => {
  let attempts = 0;
  const queue = new UploadQueue(Array.from({ length: 5 }, () => file()), meta, {
    intent: async (f, m, signal, token) => {
      attempts++;
      if (attempts <= 2 && !token) throw new UploadError('Traffic check required.', 'upload', { status: 403 });
      return { resourceId: String(attempts) };
    },
    put: async () => {}, complete: async id => ({ id, status: 'active' }), cancel: async () => {},
  }, () => {});
  queue.start();
  for (let i = 0; i < 20 && queue.running.size; i++) await tick();
  assert.equal(queue.items.filter(item => item.stage === 'active').length, 3);
  assert.equal(queue.items[0].challenge, 'upload'); assert.equal(queue.items[0].uncertain, undefined);
  queue.retry('0'); await tick(); assert.equal(attempts, 5);
  queue.retry('0', 'fresh-check-token'); await tick();
  assert.equal(attempts, 6); assert.equal(queue.items[0].stage, 'active');
});

test('completion challenge retries without creating or transferring another object', async () => {
  let intents = 0, puts = 0, completes = 0;
  const queue = new UploadQueue([file()], meta, {
    intent: async () => { intents++; return { resourceId: 'one' }; },
    put: async () => { puts++; },
    complete: async (id, signal, token) => { completes++; if (!token) throw new UploadError('Check required.', 'complete', { status: 403 }); return { id, status: 'active' }; },
    cancel: async () => {},
  }, () => {});
  queue.start(); await tick(); assert.equal(queue.items[0].challenge, 'complete');
  queue.retry('0', 'fresh-check-token'); await tick();
  assert.equal(intents, 1); assert.equal(puts, 1); assert.equal(completes, 2); assert.equal(queue.items[0].stage, 'active');
});

test('unsupported file type affects its row while valid files keep uploading', async () => {
  let intents = 0;
  const queue = new UploadQueue([file('script.exe'), file()], meta, {
    intent: async () => { intents++; return { resourceId: 'valid' }; },
    put: async () => {}, complete: async id => ({ id, status: 'active' }), cancel: async () => {},
  }, () => {});
  queue.start(); await tick();
  assert.equal(intents, 1); assert.equal(queue.items[0].stage, 'error'); assert.equal(queue.items[0].uncertain, undefined);
  assert.equal(queue.items[1].stage, 'active');
});
