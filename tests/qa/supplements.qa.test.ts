import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { SlrClient } from '../../src/modules/slr-client/slr-client.js';
import { computeIntegrityHash, importSnapshot, validateImport } from '../../src/modules/snapshots/snapshot-import.service.js';
import { assessReadiness } from '../../src/modules/snapshots/snapshot-readiness.js';
import { importInputSchema } from '../../src/modules/snapshots/slr-source.schemas.js';
import { FakeSlrBe } from '../slr-client/fake-slr-be.js';

// QA for the supplements (PRISMA writing export + RQ findings). Needs PostgreSQL.
const app = createApp();
const fake = new FakeSlrBe();
const redirectTarget = new FakeSlrBe();
const tag = `qa-sup-${Date.now()}`;
const alice = `${tag}-alice`;
const TOKEN = 'Bearer user-token-SECRET-xyz';
const real = () => JSON.parse(readFileSync(new URL('../fixtures/real/slr-be-demo-run.json', import.meta.url), 'utf8'));
let counter = 0;
const unhandled: unknown[] = [];
const onUnhandled = (r: unknown) => unhandled.push(r);
const originalBase = env.SLR_API_BASE_URL;
const originalTimeout = env.SLR_API_TIMEOUT_MS;

const issueCodes = (input: unknown) => validateImport(input).issues.map((i) => i.code);
const parseErr = (input: unknown) => { try { validateImport(input); return 'ok'; } catch (e: any) { return `${e.statusCode}:${e.code}`; } };

/** Real run re-homed to a fresh SLR project id (supplement's own project.id is left untouched unless asked). */
function realFor(slrProjectId: string, mutate?: (r: any) => void) {
  const raw = real();
  raw.run.project_id = slrProjectId;
  raw.corpus.project_id = slrProjectId;
  raw.supplements.prisma_writing_export.project.id = slrProjectId;
  mutate?.(raw);
  return raw;
}
/** Real structure with one document + one evidence quote derived from the first study/finding. */
function withEvidence(raw: any) {
  const s = raw.corpus.studies[0];
  const f = raw.corpus.findings.find((x: any) => x.study_id === s.study_id);
  raw.corpus.documents.push({ document_id: 'qa-doc-1', study_id: s.study_id, kind: 'fulltext_markdown', source_revisions: ['r1'], source_hashes: ['h1'] });
  s.document_ids = [...s.document_ids, 'qa-doc-1'];
  raw.corpus.evidence.push({
    evidence_id: 'qa-ev-1', study_id: s.study_id, field_id: f.field_id, finding_ids: [f.finding_id], document_id: 'qa-doc-1',
    source_revision: 'r1', source_hash: 'h1',
    source_location: { page: 1, section: 'Results', paragraph: 2, table_or_figure: null, char_start: 0, char_end: 10 },
    quote: 'pass@1 of 28.8%', quote_hash: 'qh', quote_hash_verified: true, consensus_value_match: 'match',
  });
  f.evidence_ids = [...f.evidence_ids, 'qa-ev-1'];
  return raw;
}
async function newProject(owner = alice) {
  const slrProjectId = `${tag}-p${counter++}`;
  const project = await prisma.project.create({ data: { name: slrProjectId, ownerId: owner, slrProjectId } });
  return { project, slrProjectId };
}
const as = (uid = alice, token: string | null = TOKEN) => ({ 'X-Dev-User-Id': uid, ...(token ? { Authorization: token } : {}) });
const supRows = (snapshotId: string) => prisma.snapshotSupplement.findMany({ where: { snapshotId }, orderBy: { kind: 'asc' } });
const prismaPath = (p: string) => `/api/projects/${p}/prisma/writing-export.json`;
const findingsPath = (p: string) => `/api/projects/${p}/synthesis/findings`;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function reorderKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorderKeys(v)]));
  return value;
}

beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);
  await fake.start(); await redirectTarget.start();
  env.SLR_API_BASE_URL = fake.baseUrl;
});
afterAll(async () => {
  process.off('unhandledRejection', onUnhandled);
  env.SLR_API_BASE_URL = originalBase; env.SLR_API_TIMEOUT_MS = originalTimeout;
  await fake.stop(); await redirectTarget.stop(); await prisma.$disconnect();
});
beforeEach(() => { fake.reset(); redirectTarget.reset(); env.SLR_API_TIMEOUT_MS = originalTimeout; });

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: payload shapes', () => {
  const base = () => realFor('p');
  it.each([
    ['supplements null', (r: any) => { r.supplements = null; }],
    ['supplements array', (r: any) => { r.supplements = [r.supplements.prisma_writing_export]; }],
    ['supplements string', (r: any) => { r.supplements = 'x'; }],
    ['prisma export null', (r: any) => { r.supplements.prisma_writing_export = null; }],
    ['prisma export array', (r: any) => { r.supplements.prisma_writing_export = [r.supplements.prisma_writing_export]; }],
    ['rq_findings object', (r: any) => { r.supplements.rq_findings = { a: 1 }; }],
    ['rq_findings null', (r: any) => { r.supplements.rq_findings = null; }],
    ['rq_findings of scalars', (r: any) => { r.supplements.rq_findings = [1, 'a']; }],
    ['studiesIncluded string', (r: any) => { r.supplements.prisma_writing_export.flow.studiesIncluded = '6'; }],
    ['studiesIncluded float', (r: any) => { r.supplements.prisma_writing_export.flow.studiesIncluded = 6.5; }],
    ['studiesIncluded missing', (r: any) => { delete r.supplements.prisma_writing_export.flow.studiesIncluded; }],
    ['flow missing', (r: any) => { delete r.supplements.prisma_writing_export.flow; }],
    ['includedStudies missing', (r: any) => { delete r.supplements.prisma_writing_export.includedStudies; }],
    ['includedStudies item without id', (r: any) => { r.supplements.prisma_writing_export.includedStudies[0].id = ''; }],
    ['schemaVersion empty', (r: any) => { r.supplements.prisma_writing_export.schemaVersion = ''; }],
  ])('%s -> 400 INVALID_IMPORT_INPUT (no 500)', (_name, mutate) => {
    const r = base(); mutate(r);
    expect(parseErr(r)).toBe('400:INVALID_IMPORT_INPUT');
  });

  it('studiesIncluded negative is rejected (a count cannot be negative)', () => {
    const r = base(); r.supplements.prisma_writing_export.flow.studiesIncluded = -6;
    expect(parseErr(r)).toBe('400:INVALID_IMPORT_INPUT');
  });

  it('studiesIncluded null falls back to includedStudies.length', () => {
    const r = base(); r.supplements.prisma_writing_export.flow.studiesIncluded = null;
    expect(issueCodes(r)).not.toContain('PRISMA_COUNT_MISMATCH');
    r.supplements.prisma_writing_export.includedStudies.pop();
    expect(issueCodes(r)).toContain('PRISMA_COUNT_MISMATCH');
  });

  it('rq_findings [] and supplements {} are accepted', () => {
    const r = base(); r.supplements.rq_findings = [];
    expect(parseErr(r)).toBe('ok');
    r.supplements = {};
    expect(issueCodes(r)).toContain('PRISMA_EXPORT_MISSING');
  });

  it('unknown fields pass through on both supplements, unknown supplement kinds are dropped', () => {
    const r = base();
    r.supplements.prisma_writing_export.extra = { deep: [1, { x: 'y' }] };
    r.supplements.prisma_writing_export.flow.extraFlow = 3;
    r.supplements.rq_findings = [{ researchQuestionId: 'rq1', answer: 'A', extra: true }];
    r.supplements.evil_kind = { a: 1 };
    const parsed = importInputSchema.parse(r);
    expect((parsed.supplements.prisma_writing_export as any).extra).toEqual({ deep: [1, { x: 'y' }] });
    expect((parsed.supplements.prisma_writing_export as any).flow.extraFlow).toBe(3);
    expect(parsed.supplements.rq_findings).toEqual([{ researchQuestionId: 'rq1', answer: 'A', extra: true }]);
    expect(Object.keys(parsed.supplements).sort()).toEqual(['prisma_writing_export', 'rq_findings']);
  });

  it('__proto__ / constructor keys do not pollute prototypes and do not crash', () => {
    const text = JSON.stringify(base()).replace('"schemaVersion":"slr-prisma-writing-v1"',
      '"schemaVersion":"slr-prisma-writing-v1","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}');
    const r = JSON.parse(text);
    r.supplements.rq_findings = JSON.parse('[{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}]');
    const parsed = importInputSchema.parse(r);
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).isAdmin).toBeUndefined();
    expect(({} as any).x).toBeUndefined();
    expect(() => computeIntegrityHash(parsed)).not.toThrow();
    expect(validateImport(r).status).toBe('READY');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: readiness warnings', () => {
  it('real run (0 evidence, 3 claims, matching PRISMA) -> NO_EVIDENCE only among new codes', () => {
    const codes = issueCodes(realFor('p'));
    expect(codes).toContain('NO_EVIDENCE');
    expect(codes).not.toContain('NO_CLAIMS');
    expect(codes).not.toContain('PRISMA_EXPORT_MISSING');
    expect(codes).not.toContain('PRISMA_COUNT_MISMATCH');
  });
  it('real structure with evidence -> no NO_EVIDENCE, READY', () => {
    const r = withEvidence(realFor('p'));
    const report = validateImport(r);
    expect(report.status).toBe('READY');
    expect(report.issues.map((i) => i.code)).not.toContain('NO_EVIDENCE');
  });
  it('no claims -> NO_CLAIMS', () => {
    expect(issueCodes(realFor('p', (r) => { r.corpus.claims = []; }))).toContain('NO_CLAIMS');
  });
  it.each([[7], [5], [0]])('studiesIncluded %i vs 6 studies -> PRISMA_COUNT_MISMATCH', (n) => {
    expect(issueCodes(realFor('p', (r) => { r.supplements.prisma_writing_export.flow.studiesIncluded = n; }))).toContain('PRISMA_COUNT_MISMATCH');
  });
  it('no supplements key -> PRISMA_EXPORT_MISSING exactly once, no MISMATCH', () => {
    const codes = issueCodes(realFor('p', (r) => { delete r.supplements; }));
    expect(codes.filter((c) => c === 'PRISMA_EXPORT_MISSING')).toHaveLength(1);
    expect(codes).not.toContain('PRISMA_COUNT_MISMATCH');
  });
  it('studiesIncluded matches corpus but includedStudies list disagrees (0 entries) -> some warning', () => {
    const codes = issueCodes(realFor('p', (r) => { r.supplements.prisma_writing_export.includedStudies = []; }));
    expect(codes).toContain('PRISMA_LIST_MISMATCH');
  });
  it('includedStudies ids are not the corpus studies (same count) -> some warning', () => {
    const codes = issueCodes(realFor('p', (r) => {
      r.supplements.prisma_writing_export.includedStudies.forEach((s: any, i: number) => { s.id = `other-${i}`; });
    }));
    expect(codes.some((c) => c.startsWith('PRISMA_'))).toBe(true);
  });
  it('duplicate includedStudies ids -> some warning', () => {
    const codes = issueCodes(realFor('p', (r) => {
      const list = r.supplements.prisma_writing_export.includedStudies;
      list[1] = { ...list[1], id: list[0].id };
    }));
    expect(codes.some((c) => c.startsWith('PRISMA_') || c === 'DUPLICATE_ID')).toBe(true);
  });
  it('PRISMA export describing a different project (project.id) -> some warning or block', () => {
    const codes = issueCodes(realFor('p', (r) => { r.supplements.prisma_writing_export.project.id = 'some-other-project'; }));
    expect(codes.some((c) => c.startsWith('PRISMA_') || c.includes('PROJECT'))).toBe(true);
  });
  it('warnings never block: all new codes are warnings', () => {
    const r = realFor('p', (x) => { x.corpus.claims = []; x.supplements.prisma_writing_export.flow.studiesIncluded = 1; });
    const report = validateImport(r);
    expect(report.status).toBe('READY');
    for (const c of ['NO_CLAIMS', 'NO_EVIDENCE', 'PRISMA_COUNT_MISMATCH']) {
      expect(report.issues.find((i) => i.code === c)?.severity).toBe('warning');
    }
  });
  it('assessReadiness on an in-process input with supplements undefined does not throw', () => {
    const parsed = importInputSchema.parse(realFor('p'));
    expect(() => assessReadiness({ ...parsed, supplements: undefined as any })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: integrity hash', () => {
  const parse = (r: unknown) => importInputSchema.parse(r);
  it('stable under key reordering at every level', () => {
    const a = parse(realFor('p'));
    const b = parse(reorderKeys(realFor('p')));
    expect(computeIntegrityHash(b)).toBe(computeIntegrityHash(a));
  });
  it.each([
    ['prisma title', (r: any) => { r.supplements.prisma_writing_export.includedStudies[3].title += '!'; }],
    ['prisma deep flow', (r: any) => { r.supplements.prisma_writing_export.flow.recordsIdentified.unclassified = 7; }],
    ['prisma schemaVersion', (r: any) => { r.supplements.prisma_writing_export.schemaVersion = 'v2'; }],
    ['rq_findings item added', (r: any) => { r.supplements.rq_findings.push({ answer: 'x' }); }],
    ['rq_findings removed', (r: any) => { delete r.supplements.rq_findings; }],
    ['prisma removed', (r: any) => { delete r.supplements.prisma_writing_export; }],
    ['unicode change', (r: any) => { r.supplements.prisma_writing_export.project.title = 'Đánh giá 🚀'; }],
  ])('changes on any supplement edit: %s', (_n, mutate) => {
    const a = computeIntegrityHash(parse(realFor('p')));
    const r = realFor('p'); mutate(r);
    expect(computeIntegrityHash(parse(r))).not.toBe(a);
  });
  it('no supplements: hash equals the pre-supplement formula; {} equals missing', () => {
    const r = realFor('p'); delete r.supplements;
    const p = parse(r);
    const legacy = `sha256:${createHash('sha256').update(stableStringify({ corpus: p.corpus, artifacts: p.artifacts })).digest('hex')}`;
    expect(computeIntegrityHash(p)).toBe(legacy);
    expect(computeIntegrityHash(parse({ ...r, supplements: {} }))).toBe(legacy);
  });
  it('rq_findings [] (present but empty) hashes differently from absent', () => {
    const r = realFor('p'); delete r.supplements.prisma_writing_export;
    const empty = computeIntegrityHash(parse(r));
    delete r.supplements.rq_findings;
    expect(computeIntegrityHash(parse(r))).not.toBe(empty);
  });
  it('a corpus key named "supplements" cannot collide with real supplements', () => {
    // The hash input is {corpus, artifacts[, supplements]}; corpus passthrough fields live inside corpus, so no collision.
    const r1 = realFor('p'); delete r1.supplements; r1.corpus.supplements = { x: 1 };
    const r2 = realFor('p'); r2.supplements = { rq_findings: [{ x: 1 }] };
    expect(computeIntegrityHash(parse(r1))).not.toBe(computeIntegrityHash(parse(r2)));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: client 404 vs other statuses', () => {
  const fetchIt = (p: string, runId: string, opts: { timeoutMs?: number; maxResponseBytes?: number } = {}) =>
    new SlrClient({ baseUrl: fake.baseUrl, timeoutMs: 2000, ...opts }).fetchRun(p, runId, { authorization: TOKEN });
  const outcome = (pr: Promise<any>) => pr.then((v) => `ok:${Object.keys(v.supplements).sort().join(',')}`, (e) => `${e.statusCode}:${e.code}:${e.message}`);

  type Setup = (path: string) => void;
  const cases: [string, Setup, string][] = [
    ['401', (p) => fake.json(p, { message: 'nope' }, 401), '401:SLR_AUTH_REJECTED'],
    ['403', (p) => fake.json(p, { message: 'nope' }, 403), '403:SLR_FORBIDDEN'],
    ['500', (p) => fake.json(p, { message: 'SECRET' }, 500), '502:SLR_UPSTREAM_ERROR'],
    ['204', (p) => fake.on(p, (_q, res) => { res.statusCode = 204; res.end(); }), '502:SLR_INVALID_RESPONSE'],
    ['HTML 200', (p) => fake.raw(p, '<html>SECRET</html>'), '502:SLR_INVALID_RESPONSE'],
    ['empty 200', (p) => fake.raw(p, ''), '502:SLR_INVALID_RESPONSE'],
    ['error envelope 200', (p) => fake.json(p, { success: false, message: 'SECRET' }), '502:SLR_UPSTREAM_ERROR'],
    ['data null 200', (p) => fake.json(p, { success: true, data: null }), '502:SLR_INVALID_RESPONSE'],
    ['hang', (p) => fake.hang(p), '504:SLR_TIMEOUT'],
    ['hang mid-body', (p) => fake.on(p, (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"success":true,'); }), '504:SLR_TIMEOUT'],
    ['redirect', (p) => fake.redirect(p, `${redirectTarget.baseUrl}/steal`), '502:SLR_UNREACHABLE'],
    ['connection reset', (p) => fake.on(p, (q) => { q.socket.destroy(); }), '502:SLR_UNREACHABLE'],
    ['reset mid-body', (p) => fake.on(p, (q, res) => { res.writeHead(200); res.write('{"a":'); setTimeout(() => q.socket.destroy(), 20); }), '502:'],
  ];

  for (const which of ['prisma', 'findings'] as const) {
    it(`404 on ${which} -> absent, the other is kept`, async () => {
      const { slrProjectId } = await newProject();
      const raw = realFor(slrProjectId);
      raw.supplements.rq_findings = [{ answer: 'a' }];
      fake.serveRun(slrProjectId, raw);
      fake.json(which === 'prisma' ? prismaPath(slrProjectId) : findingsPath(slrProjectId), { success: false, message: 'not found' }, 404);
      expect(await outcome(fetchIt(slrProjectId, raw.run.run_id))).toBe(which === 'prisma' ? 'ok:rq_findings' : 'ok:prisma_writing_export');
    });
    it(`404 HTML body on ${which} -> absent`, async () => {
      const { slrProjectId } = await newProject();
      const raw = realFor(slrProjectId);
      raw.supplements.rq_findings = [{ answer: 'a' }];
      fake.serveRun(slrProjectId, raw);
      fake.raw(which === 'prisma' ? prismaPath(slrProjectId) : findingsPath(slrProjectId), '<html>404</html>', 404);
      expect((await outcome(fetchIt(slrProjectId, raw.run.run_id))).startsWith('ok:')).toBe(true);
    });
    it.each(cases)(`${which}: %s fails the whole fetch cleanly`, async (_n, setup, expected) => {
      const { slrProjectId } = await newProject();
      const raw = realFor(slrProjectId);
      raw.supplements.rq_findings = [{ answer: 'a' }];
      fake.serveRun(slrProjectId, raw);
      setup(which === 'prisma' ? prismaPath(slrProjectId) : findingsPath(slrProjectId));
      const t = Date.now();
      const out = await outcome(fetchIt(slrProjectId, raw.run.run_id, { timeoutMs: 400 }));
      expect(out.startsWith(expected), out).toBe(true);
      expect(out).not.toContain('SECRET');
      expect(out).not.toContain('user-token');
      expect(out).not.toContain('127.0.0.1');
      expect(Date.now() - t).toBeLessThan(5000);
      expect(redirectTarget.requests).toHaveLength(0);
    });
  }

  it('supplement requests carry the user token and only go to the linked project', async () => {
    const { slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    fake.serveRun(slrProjectId, raw);
    await fetchIt(slrProjectId, raw.run.run_id);
    const sup = fake.requests.filter((r) => r.url.includes('/prisma/') || r.url.endsWith('/synthesis/findings'));
    expect(sup).toHaveLength(2);
    expect(sup.every((r) => r.authorization === TOKEN && r.method === 'GET')).toBe(true);
  });

  it('size limit applies per supplement response: just under ok, just over 502 TOO_LARGE', async () => {
    const { slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    fake.serveRun(slrProjectId, raw);
    const limit = Buffer.byteLength(JSON.stringify({ success: true, isSuccess: true, data: raw.corpus, message: 'ok' })) + 10;
    const make = (size: number) => {
      const env1 = { success: true, data: [{ answer: '' }] };
      const overhead = Buffer.byteLength(JSON.stringify(env1));
      env1.data[0].answer = 'é'.repeat(Math.floor((size - overhead) / 2));
      return JSON.stringify(env1);
    };
    fake.raw(findingsPath(slrProjectId), make(limit - 1));
    expect((await outcome(fetchIt(slrProjectId, raw.run.run_id, { maxResponseBytes: limit }))).startsWith('ok:')).toBe(true);
    fake.raw(findingsPath(slrProjectId), make(limit + 4));
    expect(await outcome(fetchIt(slrProjectId, raw.run.run_id, { maxResponseBytes: limit }))).toMatch(/^502:SLR_RESPONSE_TOO_LARGE/);
  });

  it('raw (non-enveloped) PRISMA export, as real slr-be sends it, is accepted', async () => {
    const { slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    fake.serveRun(slrProjectId, raw);
    fake.json(prismaPath(slrProjectId), raw.supplements.prisma_writing_export);
    // The fixture's rq_findings is [] and serveRun also serves it, so both are present.
    expect(await outcome(fetchIt(slrProjectId, raw.run.run_id))).toBe('ok:prisma_writing_export,rq_findings');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: from-slr route', () => {
  const post = (id: string, runId: string) => request(app).post(`/api/projects/${id}/snapshots/from-slr`).set(as()).send({ runId });

  it('stores both supplements and returns 201; GET snapshot works', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = withEvidence(realFor(slrProjectId));
    raw.supplements.rq_findings = [{ researchQuestionId: 'rq', answer: 'Yes 🚀 Đúng' }];
    fake.serveRun(slrProjectId, raw);
    const res = await post(project.id, raw.run.run_id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await supRows(res.body.data.snapshot.id);
    expect(rows.map((r) => r.kind)).toEqual(['prisma_writing_export', 'rq_findings']);
    expect(rows[1].payload).toEqual([{ researchQuestionId: 'rq', answer: 'Yes 🚀 Đúng' }]);
    expect(res.body.data.warnings.map((w: any) => w.code)).not.toContain('NO_EVIDENCE');
    const get = await request(app).get(`/api/projects/${project.id}/snapshots/${res.body.data.snapshot.id}`).set(as());
    expect(get.status).toBe(200);
  });

  it('both supplements 404 -> 201, no rows, PRISMA_EXPORT_MISSING', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId); delete raw.supplements;
    fake.serveRun(slrProjectId, raw);
    const res = await post(project.id, raw.run.run_id);
    expect(res.status).toBe(201);
    expect(await supRows(res.body.data.snapshot.id)).toHaveLength(0);
    expect(res.body.data.warnings.map((w: any) => w.code)).toContain('PRISMA_EXPORT_MISSING');
  });

  it.each([
    ['hang', (p: string) => fake.hang(p), 504],
    ['reset', (p: string) => fake.on(p, (q) => { q.socket.destroy(); }), 502],
    ['500 with secret body', (p: string) => fake.json(p, { message: 'SECRET', stack: 'Error at /srv' }, 500), 502],
  ])('supplement %s -> clean error, nothing stored, no leak', async (_n, setup, status) => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    fake.serveRun(slrProjectId, raw);
    setup(findingsPath(slrProjectId));
    env.SLR_API_TIMEOUT_MS = 400;
    const res = await post(project.id, raw.run.run_id);
    expect(res.status).toBe(status);
    const body = JSON.stringify(res.body);
    for (const s of ['SECRET', 'user-token', '127.0.0.1', fake.baseUrl, 'stack', 'synthesis/findings']) expect(body).not.toContain(s);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('PRISMA export of another SLR project is not stored silently as this project\'s flow', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    raw.supplements.prisma_writing_export.project.id = 'another-project';
    fake.serveRun(slrProjectId, raw);
    const res = await post(project.id, raw.run.run_id);
    const flagged = res.status >= 400 || res.body.data.warnings.some((w: any) => w.code.startsWith('PRISMA_') || w.code.includes('PROJECT'));
    expect(flagged).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: manual route and validate', () => {
  const postManual = (id: string, body: unknown) => request(app).post(`/api/projects/${id}/snapshots`).set(as()).send(body as object);

  it('client-supplied supplements on the manual route are stored but marked as manual, not slr-be', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    raw.supplements.prisma_writing_export.flow.recordsScreened = 999999;
    raw.supplements.rq_findings = [{ answer: 'forged by client' }];
    raw.supplements.evil = { x: 1 };
    const res = await postManual(project.id, raw);
    expect(res.status).toBe(201);
    const rows = await supRows(res.body.data.snapshot.id);
    // Stored (the caller owns the project), but the snapshot says it was posted by hand; unknown kinds are dropped.
    expect(rows.map((r) => r.kind)).toEqual(['prisma_writing_export', 'rq_findings']);
    expect((rows[0].payload as any).flow.recordsScreened).toBe(999999);
    const prov = await prisma.provenanceEvent.findFirst({ where: { snapshotId: res.body.data.snapshot.id } });
    expect(prov?.method).toBe('slr-be-adapter@1:manual');
    expect(res.body.data.snapshot.sourceSystem).toBe('manual');
  });

  it('manual route: supplements null -> 400 not 500', async () => {
    const { project, slrProjectId } = await newProject();
    const res = await postManual(project.id, { ...realFor(slrProjectId), supplements: null });
    expect([res.status, res.body.error?.code]).toEqual([400, 'INVALID_IMPORT_INPUT']);
  });

  it('validate route: bad supplement -> 400 naming the path; good -> 200 with PRISMA_* codes', async () => {
    const { project, slrProjectId } = await newProject();
    const bad = realFor(slrProjectId); bad.supplements.prisma_writing_export.flow.studiesIncluded = '6';
    const r1 = await request(app).post(`/api/projects/${project.id}/snapshots/validate`).set(as()).send(bad);
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toContain('supplements.prisma_writing_export.flow.studiesIncluded');
    const good = realFor(slrProjectId); good.supplements.prisma_writing_export.flow.studiesIncluded = 2;
    const r2 = await request(app).post(`/api/projects/${project.id}/snapshots/validate`).set(as()).send(good);
    expect(r2.status).toBe(200);
    expect(r2.body.data.issues.map((i: any) => i.code)).toContain('PRISMA_COUNT_MISMATCH');
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(0);
  });

  it.each([
    ['NUL char', 'a\u0000b'],
    ['lone surrogate', 'a\ud800b'],
  ])('supplement string with %s -> not a 500', async (_n, s) => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId); raw.supplements.rq_findings = [{ answer: s }];
    const res = await postManual(project.id, raw);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
  });

  it('ROOT CAUSE: NUL / lone surrogate fail in Postgres jsonb inside the store transaction; same for a corpus string', async () => {
    const reason = async (mutate: (r: any) => void) => {
      const { project, slrProjectId } = await newProject();
      const raw = realFor(slrProjectId); mutate(raw);
      return importSnapshot({ projectId: project.id, importedBy: 'u', input: raw }).then(() => 'stored', (e) => `${e.constructor.name}:${e.code ?? ''}:${String(e.message).slice(-160)}`);
    };
    const nul = await reason((r) => { r.supplements.rq_findings = [{ answer: 'a\u0000b' }]; });
    const sur = await reason((r) => { r.supplements.rq_findings = [{ answer: 'a\ud800b' }]; });
    const corpusNul = await reason((r) => { r.corpus.studies[0].title = 'a\u0000b'; });
    if (process.env.QA_ROOT_CAUSE_FILE) (await import('node:fs')).writeFileSync(process.env.QA_ROOT_CAUSE_FILE, JSON.stringify({ nul, sur, corpusNul }, null, 1));
    expect(nul).not.toBe('stored');
    expect(sur).not.toBe('stored');
  });

  it('ROOT CAUSE: deep nesting overflows the recursive stableStringify (computeIntegrityHash)', () => {
    let deep: any = [];
    for (let i = 0; i < 20000; i++) deep = [deep];
    const parsed = importInputSchema.parse(realFor('p', (r) => { r.supplements.rq_findings = [{ deep }]; }));
    expect(() => computeIntegrityHash(parsed)).toThrow(RangeError);
    const parsedArt = importInputSchema.parse(realFor('p', (r) => { r.artifacts.A1.deep = deep; }));
    expect(() => computeIntegrityHash(parsedArt)).toThrow(RangeError); // pre-existing for artifact payloads too
  });

  it('deeply nested supplement payload -> not a 500', async () => {
    const { project, slrProjectId } = await newProject();
    const depth = 20000;
    const nested = '['.repeat(depth) + ']'.repeat(depth);
    const text = JSON.stringify(realFor(slrProjectId, (r) => { r.supplements.rq_findings = [{ deep: '@@DEEP@@' }]; })).replace('"@@DEEP@@"', nested);
    const res = await request(app).post(`/api/projects/${project.id}/snapshots`).set(as()).set('content-type', 'application/json').send(text);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });

  it('large (~5 MB) supplement imports and is stored intact', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    raw.supplements.rq_findings = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, answer: 'x'.repeat(1000) }));
    const res = await postManual(project.id, raw);
    expect(res.status).toBe(201);
    const rows = await supRows(res.body.data.snapshot.id);
    expect((rows[1].payload as any[]).length).toBe(5000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: idempotency and concurrency', () => {
  it('re-import with different supplements is a new snapshot; each keeps its own supplements', async () => {
    const { project, slrProjectId } = await newProject();
    const first = realFor(slrProjectId); first.supplements.rq_findings = [{ answer: 'v1' }];
    const a = await importSnapshot({ projectId: project.id, importedBy: 'u', input: first });
    const second = realFor(slrProjectId); second.supplements.rq_findings = [{ answer: 'v2' }];
    second.supplements.prisma_writing_export.flow.studiesIncluded = 3;
    const b = await importSnapshot({ projectId: project.id, importedBy: 'u', input: second });
    expect(b.created).toBe(true);
    expect(b.snapshot.id).not.toBe(a.snapshot.id);
    expect(b.snapshot.integrityHash).toBe(computeIntegrityHash(importInputSchema.parse(second)));
    expect((await supRows(a.snapshot.id)).find((r) => r.kind === 'rq_findings')!.payload).toEqual([{ answer: 'v1' }]);
    expect((await supRows(b.snapshot.id)).find((r) => r.kind === 'rq_findings')!.payload).toEqual([{ answer: 'v2' }]);
  });

  it('re-import of a run first stored without supplements adds a new snapshot that has them', async () => {
    const { project, slrProjectId } = await newProject();
    const first = realFor(slrProjectId); delete first.supplements;
    const a = await importSnapshot({ projectId: project.id, importedBy: 'u', input: first });
    expect(a.readiness.issues.map((i) => i.code)).toContain('PRISMA_EXPORT_MISSING');
    const second = realFor(slrProjectId); // now with a PRISMA export
    const b = await importSnapshot({ projectId: project.id, importedBy: 'u', input: second });
    expect(b.created).toBe(true);
    expect(await supRows(a.snapshot.id)).toHaveLength(0);
    expect(await supRows(b.snapshot.id)).toHaveLength(2);
    expect(b.readiness.issues.map((i) => i.code)).toEqual((b.snapshot.issues as any[]).map((i) => i.code));
  });

  it('6 concurrent imports of identical content -> one snapshot, one set of rows, no error', async () => {
    const { project, slrProjectId } = await newProject();
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => {
      const r = realFor(slrProjectId); void i;
      return importSnapshot({ projectId: project.id, importedBy: 'u', input: r });
    }));
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => String(r.reason))).toEqual([]);
    const ok = results.map((r: any) => r.value);
    expect(ok.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(ok.map((r) => r.snapshot.id)).size).toBe(1);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.snapshotSupplement.count({ where: { snapshot: { projectId: project.id } } })).toBe(2);
  });

  it('concurrent from-slr HTTP imports -> one 201, rest 200, no 500', async () => {
    const { project, slrProjectId } = await newProject();
    const raw = realFor(slrProjectId);
    fake.serveRun(slrProjectId, raw);
    const res = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post(`/api/projects/${project.id}/snapshots/from-slr`).set(as()).send({ runId: raw.run.run_id })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await prisma.snapshotSupplement.count({ where: { snapshot: { projectId: project.id } } })).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('QA supplements: DB constraints', () => {
  async function stored() {
    const { project, slrProjectId } = await newProject();
    const { snapshot } = await importSnapshot({ projectId: project.id, importedBy: 'u', input: realFor(slrProjectId) });
    return snapshot;
  }
  it('unique (snapshotId, kind)', async () => {
    const snapshot = await stored();
    await expect(prisma.snapshotSupplement.create({ data: { snapshotId: snapshot.id, kind: 'rq_findings', contentHash: 'x', payload: [] } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
  it('FK restrict: a snapshot with supplements cannot be deleted', async () => {
    const { project } = await newProject();
    const bare = await prisma.reviewSnapshot.create({
      data: {
        projectId: project.id, sourceRunId: 'qa-bare', corpusHash: 'h', corpusVersion: 'v', generatorVersion: 'g', integrityHash: 'i', importedBy: 'u',
        supplements: { create: { kind: 'rq_findings', contentHash: 'c', payload: [] } },
      },
    });
    await expect(prisma.reviewSnapshot.delete({ where: { id: bare.id } })).rejects.toBeTruthy();
    expect(await prisma.reviewSnapshot.count({ where: { id: bare.id } })).toBe(1);
  });
  it('FK: a supplement for a missing snapshot is rejected', async () => {
    await expect(prisma.snapshotSupplement.create({ data: { snapshotId: '00000000-0000-0000-0000-000000000000', kind: 'k', contentHash: 'c', payload: {} } }))
      .rejects.toBeTruthy();
  });
  it('contentHash matches stableStringify(payload) for stored rows', async () => {
    const snapshot = await stored();
    for (const row of await supRows(snapshot.id)) {
      expect(row.contentHash).toBe(`sha256:${createHash('sha256').update(stableStringify(row.payload)).digest('hex')}`);
    }
  });
  it('DOCUMENTED: supplement rows are not protected against UPDATE at DB level (same as SnapshotArtifact)', async () => {
    const snapshot = await stored();
    const row = (await supRows(snapshot.id))[0];
    const upd = await prisma.snapshotSupplement.update({ where: { id: row.id }, data: { payload: { tampered: true } } }).then(() => 'updated', () => 'blocked');
    const art = await prisma.snapshotArtifact.findFirstOrThrow({ where: { snapshotId: snapshot.id } });
    const updArt = await prisma.snapshotArtifact.update({ where: { id: art.id }, data: { payload: { tampered: true } } }).then(() => 'updated', () => 'blocked');
    expect([upd, updArt]).toEqual(['updated', 'updated']);
  });
});

describe('QA supplements: process health', () => {
  it('no unhandled rejections during the run', async () => {
    await new Promise((r) => setTimeout(r, 300));
    expect(unhandled).toEqual([]);
  });
});
