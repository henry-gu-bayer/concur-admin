import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchForms,
  handleGetForms,
  handleRefreshForms,
  parseFormFields,
  parseFormTypes,
  parseForms,
  readFormsSnapshot,
} from './concurForms';

const { undiciFetch, logApiCall, logApiCallFailure, getServerAccessToken } = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  logApiCall: vi.fn(),
  logApiCallFailure: vi.fn(),
  getServerAccessToken: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: undiciFetch,
  ProxyAgent: class {},
}));

vi.mock('./logger', () => ({
  logApiCall,
  logApiCallFailure,
}));

vi.mock('./concurAuth', () => ({
  getServerAccessToken,
}));

vi.mock('./entities', () => ({
  createEntityRegistry: () => ({
    require: () => ({ id: 'us-uat', baseUrl: 'https://us.example.test' }),
  }),
}));

const FORM_TYPES_XML = `<?xml version="1.0"?>
<FormTypesList xmlns="http://www.concursolutions.com/api/expense/expensereport/2011/03" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <FormType><Name>Expense Report Header</Name><FormCode>RPTINFO</FormCode></FormType>
  <FormType><Name>Expense Entry</Name><FormCode>ENTRYINFO</FormCode></FormType>
</FormTypesList>`;

const RPTINFO_FORMS_XML = `<?xml version="1.0"?>
<FormDataList xmlns="http://www.concursolutions.com/api/expense/expensereport/2011/03">
  <FormData><Name>Default Report Information</Name><FormId>nAaT8$puKKO2$pEVlsXfSruLpDfZL0wVM$s7</FormId></FormData>
  <FormData><Name>Central Reconciliation Report</Name><FormId>abc123</FormId></FormData>
</FormDataList>`;

const ENTRYINFO_FORMS_XML = `<?xml version="1.0"?>
<FormDataList xmlns="http://www.concursolutions.com/api/expense/expensereport/2011/03">
  <FormData><Name>Default Entry</Name><FormId>entry-1</FormId></FormData>
</FormDataList>`;

const FIELDS_XML = `<?xml version="1.0"?>
<FormFieldsList xmlns="http://www.concursolutions.com/api/expense/expensereport/2011/03">
  <FormField>
    <Id>Name</Id><Label>ReportName</Label><ControlType>edit</ControlType><DataType>VARCHAR</DataType>
    <MaxLength>32</MaxLength><Required>Y</Required><Cols>32</Cols><Access>RW</Access><Width>32</Width><Custom>N</Custom><Sequence>1</Sequence>
  </FormField>
  <FormField>
    <Id>ReportId</Id><Label>ReportID</Label><ControlType>static</ControlType><DataType>VARCHAR</DataType>
    <MaxLength>32</MaxLength><Required>Y</Required><Cols /><Access>RO</Access><Width /><Custom>N</Custom><Sequence>2</Sequence>
  </FormField>
  <FormField>
    <Id>Custom17</Id><Label>CostObject</Label><ControlType>picklist</ControlType><DataType>LIST</DataType>
    <MaxLength /><Required>N</Required><Cols /><Access>RW</Access><Width /><Custom>Y</Custom><Sequence>10</Sequence>
  </FormField>
</FormFieldsList>`;

function xmlResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    headers: { forEach: (cb: (value: string, key: string) => void) => cb('application/xml', 'content-type') },
  };
}

function routeByUrl(url: string) {
  if (url.endsWith('/report/Forms')) return Promise.resolve(xmlResponse(FORM_TYPES_XML));
  if (url.includes('/report/Forms/RPTINFO')) return Promise.resolve(xmlResponse(RPTINFO_FORMS_XML));
  if (url.includes('/report/Forms/ENTRYINFO')) return Promise.resolve(xmlResponse(ENTRYINFO_FORMS_XML));
  if (url.includes('/Fields')) return Promise.resolve(xmlResponse(FIELDS_XML));
  return Promise.resolve(xmlResponse('<error>not found</error>', 404));
}

let dataDir: string;

beforeEach(() => {
  undiciFetch.mockReset();
  logApiCall.mockReset();
  logApiCallFailure.mockReset();
  getServerAccessToken.mockReset();
  getServerAccessToken.mockResolvedValue('server-token');
  undiciFetch.mockImplementation(routeByUrl);
  dataDir = mkdtempSync(join(tmpdir(), 'concur-forms-'));
  vi.stubEnv('DATA_DIR', dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('XML parsers', () => {
  it('parses form types, ignoring namespaces and forcing arrays', () => {
    expect(parseFormTypes(FORM_TYPES_XML)).toEqual([
      { name: 'Expense Report Header', formCode: 'RPTINFO' },
      { name: 'Expense Entry', formCode: 'ENTRYINFO' },
    ]);
    // A single form type must still come back as an array.
    const single = `<FormTypesList xmlns="http://x"><FormType><Name>Only</Name><FormCode>ONLY</FormCode></FormType></FormTypesList>`;
    expect(parseFormTypes(single)).toEqual([{ name: 'Only', formCode: 'ONLY' }]);
  });

  it('parses forms for a form type', () => {
    expect(parseForms(RPTINFO_FORMS_XML)).toEqual([
      { name: 'Default Report Information', formId: 'nAaT8$puKKO2$pEVlsXfSruLpDfZL0wVM$s7' },
      { name: 'Central Reconciliation Report', formId: 'abc123' },
    ]);
  });

  it('parses form fields with booleans, numbers, and empty elements', () => {
    const fields = parseFormFields(FIELDS_XML);
    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({
      id: 'Name', label: 'ReportName', controlType: 'edit', dataType: 'VARCHAR',
      maxLength: 32, required: true, cols: 32, access: 'RW', width: 32, custom: false, sequence: 1,
    });
    // Empty <Cols /> and <Width /> become undefined, not NaN.
    expect(fields[1].cols).toBeUndefined();
    expect(fields[1].width).toBeUndefined();
    expect(fields[1].access).toBe('RO');
    expect(fields[2].custom).toBe(true);
    expect(fields[2].required).toBe(false);
    expect(fields[2].maxLength).toBeUndefined();
  });
});

describe('fetchForms crawl', () => {
  it('walks types → forms → fields and persists the snapshot', async () => {
    const progress: { phase: string }[] = [];
    const snapshot = await fetchForms('us-uat', { onProgress: (p) => progress.push(p) });

    expect(snapshot.formTypes).toHaveLength(2);
    const rptinfo = snapshot.formTypes[0];
    expect(rptinfo.name).toBe('Expense Report Header');
    expect(rptinfo.forms.map((f) => f.name)).toEqual(['Default Report Information', 'Central Reconciliation Report']);
    expect(rptinfo.forms[0].fields).toHaveLength(3);
    expect(snapshot.formTypes[1].forms[0].formId).toBe('entry-1');

    // Form IDs contain '$' — they must be URL-encoded in the request path.
    const fieldsCall = undiciFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/Form/'));
    expect(fieldsCall).toContain('nAaT8%24puKKO2%24pEVlsXfSruLpDfZL0wVM%24s7');
    expect(fieldsCall).not.toContain('$');

    // Every request is logged to the API log.
    expect(logApiCall).toHaveBeenCalledTimes(1 + 2 + 3);
    expect(progress[0]).toMatchObject({ phase: 'types', types: 2 });
    expect(progress.some((p) => p.phase === 'done-form')).toBe(true);

    // Persisted for offline review.
    expect(existsSync(join(dataDir, 'us-uat', 'forms.json'))).toBe(true);
    expect(readFormsSnapshot('us-uat')?.formTypes).toHaveLength(2);
  });

  it('records per-form errors and keeps crawling', async () => {
    undiciFetch.mockImplementation((url: string) => {
      if (url.includes('/Form/entry-1/Fields')) return Promise.resolve(xmlResponse('<error>denied</error>', 403));
      return routeByUrl(url);
    });

    const snapshot = await fetchForms('us-uat');
    expect(snapshot.formTypes[0].forms[0].error).toBeUndefined();
    expect(snapshot.formTypes[1].forms[0].error).toContain('HTTP 403');
    expect(snapshot.formTypes[1].forms[0].fields).toEqual([]);
  });

  it('records per-type errors when the forms request fails', async () => {
    undiciFetch.mockImplementation((url: string) => {
      if (url.includes('/report/Forms/ENTRYINFO')) return Promise.resolve(xmlResponse('<error>denied</error>', 403));
      return routeByUrl(url);
    });

    const snapshot = await fetchForms('us-uat');
    expect(snapshot.formTypes[0].forms).toHaveLength(2);
    expect(snapshot.formTypes[1].error).toContain('HTTP 403');
    expect(snapshot.formTypes[1].forms).toEqual([]);
  });
});

function fakeResponse() {
  const chunks: string[] = [];
  return {
    chunks,
    statusCode: 0 as number,
    body: '' as string,
    ended: false,
    writeHead(code: number) { this.statusCode = code; },
    write(chunk: string) { chunks.push(chunk); return true; },
    flushHeaders() {},
    end(body?: string) { this.body = body ?? ''; this.ended = true; },
  };
}

describe('HTTP handlers', () => {
  it('handleGetForms returns 404 until a snapshot exists, then serves it', async () => {
    const missing = fakeResponse();
    handleGetForms(missing, 'us-uat');
    expect(missing.statusCode).toBe(404);

    await fetchForms('us-uat');
    const found = fakeResponse();
    handleGetForms(found, 'us-uat');
    expect(found.statusCode).toBe(200);
    expect(JSON.parse(found.body).formTypes).toHaveLength(2);
  });

  it('handleRefreshForms streams progress and a done summary over SSE', async () => {
    const res = fakeResponse();
    handleRefreshForms(res, 'us-uat');
    await vi.waitFor(() => expect(res.ended).toBe(true));

    const raw = res.chunks.join('');
    expect(raw).toContain('event: progress');
    expect(raw).toContain('event: done');
    const doneFrame = raw.split('\n\n').find((f) => f.includes('event: done'));
    const summary = JSON.parse(doneFrame!.match(/^data: (.+)$/m)![1]);
    expect(summary).toMatchObject({ types: 2, forms: 3, fields: 9, failed: 0 });
    expect(readFormsSnapshot('us-uat')?.formTypes).toHaveLength(2);
  });
});
