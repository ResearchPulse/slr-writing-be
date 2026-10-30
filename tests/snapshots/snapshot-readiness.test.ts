import { describe, expect, it } from 'vitest';
import { assessReadiness } from '../../src/modules/snapshots/snapshot-readiness.js';
import { importInputSchema } from '../../src/modules/snapshots/slr-source.schemas.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';

const load = (mutate?: (input: any) => void) => {
  const raw = buildSyntheticRun() as any;
  mutate?.(raw);
  return importInputSchema.parse(raw);
};
const codes = (report: ReturnType<typeof assessReadiness>, severity?: string) =>
  report.issues.filter((issue) => !severity || issue.severity === severity).map((issue) => issue.code);

describe('assessReadiness', () => {
  it('marks a complete run as READY', () => {
    const report = assessReadiness(load());
    expect(report.status).toBe('READY');
    expect(codes(report, 'blocking')).toEqual([]);
  });

  it('blocks when there are no research questions', () => {
    const report = assessReadiness(load((i) => { i.corpus.research_questions = []; }));
    expect(report.status).toBe('BLOCKED');
    expect(codes(report)).toContain('NO_RESEARCH_QUESTIONS');
  });

  it('blocks when a required artifact is missing, invalid, rejected or not approved', () => {
    expect(codes(assessReadiness(load((i) => { i.run.artifacts = i.run.artifacts.filter((a: any) => a.artifact_type !== 'A1'); })))).toContain('ARTIFACT_MISSING');
    expect(codes(assessReadiness(load((i) => { i.run.artifacts[0].validation_status = 'invalid'; })))).toContain('ARTIFACT_INVALID');
    expect(codes(assessReadiness(load((i) => { i.run.artifacts[0].review_status = 'rejected'; })))).toContain('ARTIFACT_REJECTED');
    expect(codes(assessReadiness(load((i) => { i.run.artifacts[0].review_status = 'unreviewed'; })))).toContain('ARTIFACT_NOT_APPROVED');
  });

  it('blocks when a required artifact is listed but its content is absent', () => {
    const report = assessReadiness(load((i) => { delete i.artifacts.A10; }));
    expect(codes(report, 'blocking')).toContain('ARTIFACT_PAYLOAD_MISSING');
  });

  it('only warns when an optional artifact is missing', () => {
    const report = assessReadiness(load((i) => { delete i.artifacts.A7; }));
    expect(report.status).toBe('READY');
    expect(codes(report, 'warning')).toContain('OPTIONAL_ARTIFACT_MISSING');
  });

  it('blocks on a corpus hash mismatch between run and corpus', () => {
    const report = assessReadiness(load((i) => { i.corpus.corpus_hash = 'other'; }));
    expect(codes(report)).toContain('CORPUS_HASH_MISMATCH');
  });

  it('blocks on dangling references', () => {
    const report = assessReadiness(load((i) => { i.corpus.evidence[0].document_id = 'nope'; }));
    expect(report.status).toBe('BLOCKED');
    expect(codes(report)).toContain('UNKNOWN_DOCUMENT');
  });

  it('blocks on duplicate ids', () => {
    const report = assessReadiness(load((i) => { i.corpus.studies.push({ ...i.corpus.studies[0] }); }));
    expect(codes(report)).toContain('DUPLICATE_ID');
  });

  it('warns, but does not block, on weak evidence', () => {
    const report = assessReadiness(load((i) => {
      i.corpus.evidence[0].quote_hash_verified = false;
      i.corpus.studies[1].extraction.status = 'NOT_COMPLETED';
      i.corpus.claims[0].items[0].value_drift = 'changed';
    }));
    expect(report.status).toBe('READY');
    expect(codes(report, 'warning')).toEqual(expect.arrayContaining(['QUOTE_NOT_VERIFIED', 'EXTRACTION_INCOMPLETE', 'VALUE_DRIFT']));
  });
});
