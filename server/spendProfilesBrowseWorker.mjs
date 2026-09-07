import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parentPort, workerData } from 'node:worker_threads';

const ORDER_PAGE_SIZE = 2048;
const ROW_CHECKPOINT_SIZE = 20_000;
const SORT_CHUNK_SIZE = 50_000;
const WRITE_BATCH_SIZE = 1_000;

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
function indexPath(field) { return join(generationDirectory, 'indexes', `${encodeURIComponent(field)}.ndjson`); }
function entryPath(field) { return join(entriesDirectory, `${encodeURIComponent(field)}.ndjson`); }
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
  if (job.phase === 'rows') return Math.min(25, Math.floor(((job.rowCount ?? 0) / Math.max(1, count)) * 25));
  const completeFields = job.completedFields?.length ?? 0;
  const withinField = count ? Math.min(1, (job.fieldEntries ?? 0) / count) : 0;
  return Math.min(99, Math.floor(25 + ((completeFields + withinField) / sortFields.length) * 74));
}

async function readIndexBatch(file, start, limit) {
  if (!existsSync(file)) throw new Error(`Spend Profiles source index is missing: ${file}.`);
  const input = createReadStream(file, { encoding: 'utf8', start });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const entries = [];
  let bytes = 0;
  try {
    for await (const line of reader) {
      if (!line) continue;
      entries.push(JSON.parse(line));
      bytes += Buffer.byteLength(line) + 1;
      if (entries.length >= limit) break;
    }
  } finally {
    reader.close();
    input.destroy();
  }
  return { entries, nextOffset: start + bytes };
}

async function appendRowBatch(rowsFile, entryFiles, sourceFields, fieldEntries, startOffset, presentValues) {
  let offset = startOffset;
  for (let batchStart = 0; batchStart < fieldEntries[0].length; batchStart += WRITE_BATCH_SIZE) {
    const batchEnd = Math.min(fieldEntries[0].length, batchStart + WRITE_BATCH_SIZE);
    const rowChunks = [];
    const entryChunks = new Map(sortFields.map((field) => [field, []]));
    for (let index = batchStart; index < batchEnd; index += 1) {
      const id = fieldEntries[0][index].id;
      const values = {};
      for (let fieldIndex = 0; fieldIndex < sourceFields.length; fieldIndex += 1) {
        const entry = fieldEntries[fieldIndex][index];
        if (!entry || entry.id !== id) throw new Error(`Spend Profiles source index ${sourceFields[fieldIndex]} is not aligned at record ${index}.`);
        values[sourceFields[fieldIndex]] = entry.value ?? '';
      }
      const row = {
        id,
        loginId: values.loginId ?? '',
        employeeNumber: values.employeeNumber ?? '',
        email: values.email ?? '',
        preferredName: values.preferredName ?? '',
        values,
      };
      const encoded = Buffer.from(`${JSON.stringify(row)}\n`);
      rowChunks.push(encoded);
      const present = presentValues[index] === 'true';
      for (const field of sortFields) entryChunks.get(field).push(`${JSON.stringify({ id, value: values[field] ?? '', offset, length: encoded.length, present })}\n`);
      offset += encoded.length;
    }
    await rowsFile.write(Buffer.concat(rowChunks));
    await Promise.all(sortFields.map((field) => entryFiles.get(field).write(entryChunks.get(field).join(''))));
  }
  return offset;
}

async function buildRows(job, sourceManifest) {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(entriesDirectory, { recursive: true });
  const sourceFields = [...sourceManifest.fields];
  if (!sourceFields.includes('id') || !sourceFields.includes('identityPresent')) throw new Error('The Spend Profiles source indexes are missing required identity fields.');
  const startCount = job.rowCount ?? 0;
  const rowBytes = job.rowBytes ?? 0;
  const sourceOffsets = job.sourceOffsets ?? Object.fromEntries(sourceFields.map((field) => [field, 0]));
  if (startCount === 0) {
    await writeFile(rowsPath, '');
    await Promise.all(sortFields.map((field) => writeFile(entryPath(field), '')));
  } else {
    await truncate(rowsPath, rowBytes);
    await Promise.all(sortFields.map((field) => truncate(entryPath(field), job.entryBytes?.[field] ?? 0)));
  }
  const rowsFile = await open(rowsPath, 'a');
  const entryFiles = new Map(await Promise.all(sortFields.map(async (field) => [field, await open(entryPath(field), 'a')])));
  let count = startCount;
  let presentCount = job.presentCount ?? 0;
  let outputOffset = rowBytes;
  try {
    while (count < sourceManifest.count) {
      const limit = Math.min(ROW_CHECKPOINT_SIZE, sourceManifest.count - count);
      const batches = [];
      for (const field of sourceFields) batches.push(await readIndexBatch(indexPath(field), sourceOffsets[field] ?? 0, limit));
      const expected = batches[0].entries.length;
      if (!expected) throw new Error(`Spend Profiles source indexes ended at ${count} records; expected ${sourceManifest.count}.`);
      if (batches.some((batch) => batch.entries.length !== expected)) throw new Error(`Spend Profiles source indexes have different lengths at record ${count}.`);
      const identityIndex = sourceFields.indexOf('identityPresent');
      const presentValues = batches[identityIndex].entries.map((entry) => entry.value);
      outputOffset = await appendRowBatch(rowsFile, entryFiles, sourceFields, batches.map((batch) => batch.entries), outputOffset, presentValues);
      count += expected;
      presentCount += presentValues.filter((value) => value === 'true').length;
      for (let index = 0; index < sourceFields.length; index += 1) sourceOffsets[sourceFields[index]] = batches[index].nextOffset;
      const entryBytes = Object.fromEntries(await Promise.all(sortFields.map(async (field) => [field, (await stat(entryPath(field))).size])));
      Object.assign(job, {
        phase: 'rows', rowCount: count, presentCount, sourceOffsets,
        rowBytes: (await stat(rowsPath)).size, entryBytes,
        percent: overallPercent({ ...job, rowCount: count }, sourceManifest.count),
        lastCheckpointAt: now(),
      });
      await saveJob(job);
    }
  } finally {
    await Promise.all([rowsFile.close(), ...[...entryFiles.values()].map((file) => file.close())]);
  }
  if (count !== sourceManifest.count) throw new Error(`Spend Profiles browse rows contain ${count} records; expected ${sourceManifest.count}.`);
  for (const field of sourceFields) {
    const extra = await readIndexBatch(indexPath(field), sourceOffsets[field] ?? 0, 1);
    if (extra.entries.length) throw new Error(`Spend Profiles source index ${field} contains more than ${sourceManifest.count} records.`);
  }
}

function compareEntries(left, right, collator) {
  return collator.compare(left.value, right.value) || collator.compare(left.id, right.id);
}

async function createRuns(job, field, expectedCount) {
  const runDirectory = join(outputDirectory, 'runs', encodeURIComponent(field));
  await rm(runDirectory, { recursive: true, force: true });
  await mkdir(runDirectory, { recursive: true });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const runs = [];
  let chunk = [];
  let entries = 0;
  const flush = async () => {
    if (!chunk.length) return;
    chunk.sort((left, right) => compareEntries(left, right, collator));
    const file = join(runDirectory, `${String(runs.length).padStart(4, '0')}.ndjson`);
    await writeFile(file, `${chunk.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    runs.push(file);
    chunk = [];
  };
  const reader = await lines(entryPath(field));
  for await (const line of reader) {
    if (!line) continue;
    chunk.push(JSON.parse(line));
    entries += 1;
    if (chunk.length >= SORT_CHUNK_SIZE) await flush();
    if (entries % SORT_CHUNK_SIZE === 0) {
      job.fieldEntries = entries;
      job.percent = overallPercent(job, expectedCount);
      await saveJob(job);
    }
  }
  await flush();
  if (entries !== expectedCount) throw new Error(`Spend Profiles browse order ${field} contains ${entries} records; expected ${expectedCount}.`);
  return runs;
}

async function openRunReader(file, skip = 0) {
  const reader = await lines(file);
  const iterator = reader[Symbol.asyncIterator]();
  for (let index = 0; index < skip; index += 1) {
    const discarded = await iterator.next();
    if (discarded.done) throw new Error(`Spend Profiles browse merge checkpoint exceeds ${file}.`);
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
  const presentCounts = checkpoint?.presentCounts?.length === pageIndexAtCheckpoint ? [...checkpoint.presentCounts] : [];
  if (pageIndexAtCheckpoint > 0 && (pageHashes.length !== pageIndexAtCheckpoint || presentCounts.length !== pageIndexAtCheckpoint)) throw new Error(`Spend Profiles browse merge checkpoint is incomplete for ${field}.`);
  for (let pageIndex = 0; pageIndex < pageIndexAtCheckpoint; pageIndex += 1) {
    const values = await readJson(join(orderDirectory, `${String(pageIndex).padStart(6, '0')}.json`));
    if (!values || createHash('sha256').update(JSON.stringify(values)).digest('hex') !== pageHashes[pageIndex]) throw new Error(`Spend Profiles browse order checkpoint is corrupt for ${field} page ${pageIndex}.`);
  }
  const readers = await Promise.all(runFiles.map((file, index) => openRunReader(file, consumed[index])));
  let page = [];
  let pageIndex = pageIndexAtCheckpoint;
  let merged = checkpoint?.merged ?? 0;
  const flushPage = async () => {
    if (!page.length) return;
    pageHashes.push(createHash('sha256').update(JSON.stringify(page)).digest('hex'));
    presentCounts.push(page.reduce((sum, pointer) => sum + pointer[2], 0));
    await writeJsonAtomic(join(orderDirectory, `${String(pageIndex).padStart(6, '0')}.json`), page);
    pageIndex += 1;
    page = [];
    job.fieldEntries = merged;
    job.percent = overallPercent(job, expectedCount);
    job.lastCheckpointAt = now();
    job.mergeCheckpoint = { field, pageIndex, merged, consumed: [...consumed], pageHashes: [...pageHashes], presentCounts: [...presentCounts] };
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
    page.push([entry.offset, entry.length, entry.present ? 1 : 0]);
    merged += 1;
    consumed[selected] += 1;
    const next = await readers[selected].iterator.next();
    readers[selected].current = next.done ? null : JSON.parse(next.value);
    if (page.length >= ORDER_PAGE_SIZE) await flushPage();
  }
  await flushPage();
  if (merged !== expectedCount) throw new Error(`Merged Spend Profiles browse order ${field} contains ${merged} records; expected ${expectedCount}.`);
  return { pageCount: pageIndex, count: merged, pageHashes, presentCounts };
}

async function run() {
  const sourceManifest = await readJson(join(generationDirectory, 'manifest.json'));
  if (!sourceManifest || sourceManifest.generation !== generation || !Array.isArray(sourceManifest.fields)) throw new Error('The source Spend Profiles generation is unavailable.');
  if (sortFields.some((field) => !sourceManifest.fields.includes(field))) throw new Error('The Spend Profiles browse fields do not match the source generation.');
  await mkdir(join(browseDirectory, 'generations'), { recursive: true });
  let job = await readJson(jobPath);
  if (!job || job.runId !== runId || job.sourceGeneration !== generation) {
    job = {
      format: 'spend-profiles-browse-job-v1', runId, entityId, sourceGeneration: generation,
      state: 'running', phase: 'rows', percent: 0, rowCount: 0, presentCount: 0,
      sourceOffsets: {}, rowBytes: 0, entryBytes: {}, completedFields: [], orderManifests: {}, fieldEntries: 0,
      startedAt: now(), updatedAt: now(), lastCheckpointAt: null,
    };
  }
  if ((job.rowCount ?? 0) > 0 && (!job.sourceOffsets || !job.entryBytes)) {
    await rm(outputDirectory, { recursive: true, force: true });
    Object.assign(job, { phase: 'rows', percent: 0, rowCount: 0, presentCount: 0, sourceOffsets: {}, rowBytes: 0, entryBytes: {}, completedFields: [], orderManifests: {}, fieldEntries: 0 });
  }
  job.state = 'running';
  job.error = undefined;
  await saveJob(job);
  if ((job.rowCount ?? 0) < sourceManifest.count || !existsSync(rowsPath)) await buildRows(job, sourceManifest);
  for (const field of sortFields) {
    if (job.completedFields.includes(field)) continue;
    const runDirectory = join(outputDirectory, 'runs', encodeURIComponent(field));
    const resumeMerge = job.phase === 'merging' && job.currentField === field && job.mergeCheckpoint?.field === field;
    let runs;
    if (resumeMerge) {
      runs = (await readdir(runDirectory)).filter((name) => name.endsWith('.ndjson')).sort().map((name) => join(runDirectory, name));
      if (!runs.length) throw new Error(`Spend Profiles browse merge runs are missing for ${field}.`);
    } else {
      Object.assign(job, { phase: 'sorting', currentField: field, fieldEntries: 0, mergeCheckpoint: undefined });
      await saveJob(job);
      runs = await createRuns(job, field, sourceManifest.count);
      Object.assign(job, { phase: 'merging', currentField: field, fieldEntries: 0, mergeCheckpoint: { field, pageIndex: 0, merged: 0, consumed: runs.map(() => 0), pageHashes: [], presentCounts: [] } });
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
    await rm(entryPath(field), { force: true });
    await rm(runDirectory, { recursive: true, force: true });
  }
  const rows = { bytes: (await stat(rowsPath)).size, sha256: await hashFile(rowsPath) };
  for (const field of sortFields) {
    const order = job.orderManifests?.[field];
    if (!order || order.count !== sourceManifest.count || order.pageHashes.length !== order.pageCount
      || order.presentCounts.length !== order.pageCount || order.presentCounts.reduce((sum, value) => sum + value, 0) !== job.presentCount) {
      throw new Error(`Spend Profiles browse order manifest is incomplete for ${field}.`);
    }
  }
  const manifest = {
    format: 'spend-profiles-browse-v1', entityId, sourceGeneration: generation, generation: runId,
    createdAt: now(), count: sourceManifest.count, presentCount: job.presentCount,
    pageSize: ORDER_PAGE_SIZE, sortFields, rows, orders: job.orderManifests,
  };
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(currentPath, { generation: runId });
  for (const entry of await readdir(join(browseDirectory, 'generations'))) {
    if (entry !== runId) await rm(join(browseDirectory, 'generations', entry), { recursive: true, force: true }).catch(() => undefined);
  }
  await rm(join(outputDirectory, 'runs'), { recursive: true, force: true });
  await rm(entriesDirectory, { recursive: true, force: true });
  Object.assign(job, { state: 'complete', phase: 'complete', percent: 100, currentField: undefined, fieldEntries: 0, browseGeneration: runId, lastCheckpointAt: now() });
  await saveJob(job);
  parentPort?.postMessage({ type: 'done', manifest });
}

run().catch(async (error) => {
  const job = await readJson(jobPath) ?? { format: 'spend-profiles-browse-job-v1', runId, entityId, sourceGeneration: generation, startedAt: now() };
  Object.assign(job, { state: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: now() });
  await writeJsonAtomic(jobPath, job).catch(() => undefined);
  parentPort?.postMessage({ type: 'error', error: job.error });
  process.exitCode = 1;
});
