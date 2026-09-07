import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parentPort, workerData } from 'node:worker_threads';

const ENTERPRISE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const ORDER_PAGE_SIZE = 2048;
const SORT_CHUNK_SIZE = 50_000;

const { baseDirectory, entityId, generation, runId, sortFields } = workerData;
const generationDirectory = join(baseDirectory, 'generations', generation);
const browseDirectory = join(generationDirectory, 'browse');
const outputDirectory = join(browseDirectory, 'generations', runId);
const jobPath = join(browseDirectory, 'job.json');
const rowsPath = join(outputDirectory, 'rows.ndjson');
const entriesDirectory = join(outputDirectory, 'entries');
const manifestPath = join(outputDirectory, 'manifest.json');
const currentPath = join(browseDirectory, 'current.json');

function now() { return new Date().toISOString(); }
function tempPath(file) { return `${file}.${process.pid}.tmp`; }
async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = tempPath(file);
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}
function compactProfile(profile) {
  const enterprise = profile[ENTERPRISE_SCHEMA];
  const email = profile.emails?.find((entry) => entry.type === 'work') ?? profile.emails?.[0];
  return {
    id: profile.id,
    userName: profile.userName,
    displayName: profile.displayName,
    preferredName: profile.preferredName,
    active: profile.active,
    name: profile.name ? {
      formatted: profile.name.formatted,
      givenName: profile.name.givenName,
      familyName: profile.name.familyName,
      middleName: profile.name.middleName,
    } : undefined,
    emails: email ? [email] : undefined,
    [ENTERPRISE_SCHEMA]: enterprise ? {
      employeeNumber: enterprise.employeeNumber,
      costCenter: enterprise.costCenter,
      startDate: enterprise.startDate,
    } : undefined,
  };
}
function fieldValues(profile) {
  const enterprise = profile[ENTERPRISE_SCHEMA];
  const workEmail = profile.emails?.find((entry) => entry.type === 'work')?.value ?? profile.emails?.[0]?.value ?? '';
  const joinedName = [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ');
  const name = profile.displayName ?? profile.name?.formatted ?? (joinedName || profile.userName || '');
  return {
    id: profile.id,
    name,
    preferredName: profile.preferredName ?? '',
    firstName: profile.name?.givenName ?? '',
    lastName: profile.name?.familyName ?? '',
    login: profile.userName ?? '',
    employee: enterprise?.employeeNumber ?? '',
    email: workEmail,
    active: String(profile.active ?? ''),
    costCenter: enterprise?.costCenter ?? '',
    startDate: enterprise?.startDate ?? '',
  };
}
async function lines(file) {
  const input = createReadStream(file, { encoding: 'utf8' });
  return createInterface({ input, crlfDelay: Infinity });
}
async function saveJob(job) {
  job.updatedAt = now();
  await writeJsonAtomic(jobPath, job);
  parentPort?.postMessage({ type: 'progress', job });
}
function overallPercent(job, count) {
  if (job.phase === 'rows') return Math.floor(((job.nextShard ?? 0) / 256) * 25);
  const completeFields = job.completedFields?.length ?? 0;
  const withinField = count ? Math.min(1, (job.fieldEntries ?? 0) / count) : 0;
  return Math.min(99, Math.floor(25 + ((completeFields + withinField) / sortFields.length) * 74));
}

async function buildRows(job, expectedCount) {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(entriesDirectory, { recursive: true });
  const startShard = job.nextShard ?? 0;
  const rowBytes = job.rowBytes ?? 0;
  if (startShard === 0) {
    await writeFile(rowsPath, '');
    await Promise.all(sortFields.map((field) => writeFile(join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`), '')));
  } else {
    await truncate(rowsPath, rowBytes);
    await Promise.all(sortFields.map((field) => truncate(join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`), job.entryBytes?.[field] ?? 0)));
  }
  const rows = await open(rowsPath, 'a');
  const entryFiles = new Map(await Promise.all(sortFields.map(async (field) => [field, await open(join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`), 'a')])));
  let offset = rowBytes;
  let count = job.rowCount ?? 0;
  for (let shardIndex = startShard; shardIndex < 256; shardIndex += 1) {
    const shard = shardIndex.toString(16).padStart(2, '0');
    const file = join(generationDirectory, 'shards', `${shard}.ndjson`);
    const rowChunks = [];
    const entryChunks = new Map(sortFields.map((field) => [field, []]));
    if (existsSync(file)) {
      const reader = await lines(file);
      for await (const line of reader) {
        if (!line) continue;
        const profile = JSON.parse(line);
        if (!profile.id) continue;
        const encoded = Buffer.from(`${JSON.stringify(compactProfile(profile))}\n`);
        rowChunks.push(encoded);
        const values = fieldValues(profile);
        for (const field of sortFields) entryChunks.get(field).push(`${JSON.stringify({ id: profile.id, value: values[field] ?? '', offset, length: encoded.length })}\n`);
        offset += encoded.length;
        count += 1;
      }
    }
    if (rowChunks.length) await rows.write(Buffer.concat(rowChunks));
    await Promise.all(sortFields.map((field) => entryChunks.get(field).length ? entryFiles.get(field).write(entryChunks.get(field).join('')) : undefined));
    const rowStat = await stat(rowsPath);
    const entryBytes = Object.fromEntries(await Promise.all(sortFields.map(async (field) => [field, (await stat(join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`))).size])));
    Object.assign(job, {
      phase: 'rows', nextShard: shardIndex + 1, rowCount: count,
      rowBytes: rowStat.size, entryBytes,
      percent: overallPercent({ ...job, nextShard: shardIndex + 1 }, expectedCount),
      lastCheckpointAt: now(),
    });
    await saveJob(job);
  }
  await Promise.all([rows.close(), ...[...entryFiles.values()].map((file) => file.close())]);
  if (count !== expectedCount) throw new Error(`Browse rows contain ${count} records; expected ${expectedCount}.`);
}

function compareEntries(left, right, collator) {
  return collator.compare(left.value, right.value) || collator.compare(left.id, right.id);
}

async function createRuns(job, field, expectedCount) {
  const runDirectory = join(outputDirectory, 'runs', encodeURIComponent(field));
  await rm(runDirectory, { recursive: true, force: true });
  await mkdir(runDirectory, { recursive: true });
  const indexPath = join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const runs = [];
  let chunk = [];
  let entries = 0;
  const flush = async () => {
    if (!chunk.length) return;
    chunk.sort((left, right) => compareEntries(left, right, collator));
    const file = join(runDirectory, `${String(runs.length).padStart(4, '0')}.ndjson`);
    await writeFile(file, chunk.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    runs.push(file);
    chunk = [];
  };
  const reader = await lines(indexPath);
  for await (const line of reader) {
    if (!line) continue;
    const entry = JSON.parse(line);
    chunk.push(entry);
    entries += 1;
    if (chunk.length >= SORT_CHUNK_SIZE) await flush();
    if (entries % SORT_CHUNK_SIZE === 0) {
      job.fieldEntries = entries;
      job.percent = overallPercent(job, expectedCount);
      await saveJob(job);
    }
  }
  await flush();
  if (entries !== expectedCount) throw new Error(`Browse order ${field} contains ${entries} records; expected ${expectedCount}.`);
  return runs;
}

async function openRunReader(file, skip = 0) {
  const reader = await lines(file);
  const iterator = reader[Symbol.asyncIterator]();
  for (let index = 0; index < skip; index += 1) {
    const discarded = await iterator.next();
    if (discarded.done) throw new Error(`Browse merge checkpoint exceeds ${file}.`);
  }
  const first = await iterator.next();
  return { iterator, current: first.done ? null : JSON.parse(first.value) };
}

async function mergeRuns(job, field, runFiles, expectedCount) {
  const orderDirectory = join(outputDirectory, 'orders', encodeURIComponent(field));
  const checkpoint = job.phase === 'merging' && job.currentField === field && job.mergeCheckpoint?.field === field ? job.mergeCheckpoint : null;
  if (!checkpoint) await rm(orderDirectory, { recursive: true, force: true });
  await mkdir(orderDirectory, { recursive: true });
  const pageIndexAtCheckpoint = checkpoint?.pageIndex ?? 0;
  for (const name of await readdir(orderDirectory)) {
    const pageNumber = Number.parseInt(name, 10);
    if (name.endsWith('.json') && Number.isFinite(pageNumber) && pageNumber >= pageIndexAtCheckpoint) await rm(join(orderDirectory, name), { force: true });
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const consumed = checkpoint?.consumed?.length === runFiles.length ? [...checkpoint.consumed] : runFiles.map(() => 0);
  const pageHashes = checkpoint?.pageHashes?.length === pageIndexAtCheckpoint ? [...checkpoint.pageHashes] : [];
  if (pageIndexAtCheckpoint > 0 && pageHashes.length !== pageIndexAtCheckpoint) throw new Error(`Browse merge checkpoint hashes are missing for ${field}.`);
  for (let pageIndex = 0; pageIndex < pageIndexAtCheckpoint; pageIndex += 1) {
    const values = await readJson(join(orderDirectory, `${String(pageIndex).padStart(6, '0')}.json`));
    if (!values || createHash('sha256').update(JSON.stringify(values)).digest('hex') !== pageHashes[pageIndex]) throw new Error(`Browse order checkpoint is corrupt for ${field} page ${pageIndex}.`);
  }
  const readers = await Promise.all(runFiles.map((file, index) => openRunReader(file, consumed[index])));
  let page = [];
  let pageIndex = pageIndexAtCheckpoint;
  let merged = checkpoint?.merged ?? 0;
  const flushPage = async () => {
    if (!page.length) return;
    pageHashes.push(createHash('sha256').update(JSON.stringify(page)).digest('hex'));
    await writeJsonAtomic(join(orderDirectory, `${String(pageIndex).padStart(6, '0')}.json`), page);
    pageIndex += 1;
    page = [];
    job.fieldEntries = merged;
    job.percent = overallPercent(job, expectedCount);
    job.lastCheckpointAt = now();
    job.mergeCheckpoint = { field, pageIndex, merged, consumed: [...consumed], pageHashes: [...pageHashes] };
    await saveJob(job);
  };
  while (true) {
    let selected = -1;
    for (let index = 0; index < readers.length; index += 1) {
      if (!readers[index].current) continue;
      if (selected < 0 || compareEntries(readers[index].current, readers[selected].current, collator) < 0) selected = index;
    }
    if (selected < 0) break;
    const entry = readers[selected].current;
    page.push([entry.offset, entry.length]);
    merged += 1;
    consumed[selected] += 1;
    const next = await readers[selected].iterator.next();
    readers[selected].current = next.done ? null : JSON.parse(next.value);
    if (page.length >= ORDER_PAGE_SIZE) await flushPage();
  }
  await flushPage();
  if (merged !== expectedCount) throw new Error(`Merged browse order ${field} contains ${merged} records; expected ${expectedCount}.`);
  return { pageCount: pageIndex, count: merged, pageHashes };
}

async function run() {
  const sourceManifest = await readJson(join(generationDirectory, 'manifest.json'));
  if (!sourceManifest || sourceManifest.generation !== generation) throw new Error('The source Active Users generation is unavailable.');
  await mkdir(join(browseDirectory, 'generations'), { recursive: true });
  let job = await readJson(jobPath);
  if (!job || job.runId !== runId || job.sourceGeneration !== generation) {
    job = {
      format: 'active-users-browse-job-v1', runId, entityId, sourceGeneration: generation,
      state: 'running', phase: 'rows', percent: 0, nextShard: 0, rowCount: 0,
      rowBytes: 0, entryBytes: {}, completedFields: [], orderManifests: {}, fieldEntries: 0,
      startedAt: now(), updatedAt: now(), lastCheckpointAt: null,
    };
  }
  if ((job.nextShard ?? 0) > 0 && !job.entryBytes) {
    await rm(outputDirectory, { recursive: true, force: true });
    Object.assign(job, { phase: 'rows', percent: 0, nextShard: 0, rowCount: 0, rowBytes: 0, entryBytes: {}, completedFields: [], orderManifests: {}, fieldEntries: 0 });
  }
  job.state = 'running';
  job.error = undefined;
  await saveJob(job);
  if ((job.nextShard ?? 0) < 256 || job.rowCount !== sourceManifest.count) await buildRows(job, sourceManifest.count);
  for (const field of sortFields) {
    if (job.completedFields.includes(field)) continue;
    const runDirectory = join(outputDirectory, 'runs', encodeURIComponent(field));
    const resumeMerge = job.phase === 'merging' && job.currentField === field && job.mergeCheckpoint?.field === field;
    let runs;
    if (resumeMerge) {
      runs = (await readdir(runDirectory)).filter((name) => name.endsWith('.ndjson')).sort().map((name) => join(runDirectory, name));
      if (!runs.length) throw new Error(`Browse merge runs are missing for ${field}.`);
    } else {
      Object.assign(job, { phase: 'sorting', currentField: field, fieldEntries: 0, mergeCheckpoint: undefined });
      await saveJob(job);
      runs = await createRuns(job, field, sourceManifest.count);
      Object.assign(job, { phase: 'merging', currentField: field, fieldEntries: 0, mergeCheckpoint: { field, pageIndex: 0, merged: 0, consumed: runs.map(() => 0), pageHashes: [] } });
      await saveJob(job);
    }
    const orderManifest = await mergeRuns(job, field, runs, sourceManifest.count);
    job.orderManifests ??= {};
    job.orderManifests[field] = orderManifest;
    job.completedFields.push(field);
    job.fieldEntries = 0;
    job.mergeCheckpoint = undefined;
    job.percent = overallPercent(job, sourceManifest.count);
    job.lastCheckpointAt = now();
    await saveJob(job);
    await rm(join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`), { force: true });
    await rm(runDirectory, { recursive: true, force: true });
  }
  const rows = { bytes: (await stat(rowsPath)).size, sha256: await hashFile(rowsPath) };
  for (const field of sortFields) {
    const order = job.orderManifests?.[field];
    if (!order || order.count !== sourceManifest.count || order.pageHashes.length !== order.pageCount) throw new Error(`Browse order manifest is incomplete for ${field}.`);
  }
  const manifest = {
    format: 'active-users-browse-v1', entityId, sourceGeneration: generation, generation: runId,
    createdAt: now(), count: sourceManifest.count, pageSize: ORDER_PAGE_SIZE, sortFields,
    rows, orders: job.orderManifests,
  };
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(currentPath, { generation: runId });
  for (const entry of await readdir(join(browseDirectory, 'generations'))) {
    if (entry !== runId) await rm(join(browseDirectory, 'generations', entry), { recursive: true, force: true }).catch(() => undefined);
  }
  await rm(join(outputDirectory, 'runs'), { recursive: true, force: true });
  await rm(entriesDirectory, { recursive: true, force: true });
  Object.assign(job, { state: 'complete', phase: 'complete', percent: 100, currentField: undefined, fieldEntries: 0, lastCheckpointAt: now() });
  await saveJob(job);
  parentPort?.postMessage({ type: 'done', manifest });
}

run().catch(async (error) => {
  const job = await readJson(jobPath) ?? { runId, entityId, sourceGeneration: generation, startedAt: now() };
  Object.assign(job, { state: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: now() });
  await writeJsonAtomic(jobPath, job).catch(() => undefined);
  parentPort?.postMessage({ type: 'error', error: job.error });
  process.exitCode = 1;
});
