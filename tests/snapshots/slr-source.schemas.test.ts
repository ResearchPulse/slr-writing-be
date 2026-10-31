import { describe, expect, it } from 'vitest';
import { importInputSchema, unwrapEnvelope } from '../../src/modules/snapshots/slr-source.schemas.js';
import { buildSyntheticRun } from '../fixtures/synthetic-run.js';

describe('importInputSchema', () => {
  it('accepts the synthetic run and keeps unknown fields', () => {
    const parsed = importInputSchema.parse(buildSyntheticRun());
    expect(parsed.corpus.studies).toHaveLength(2);
    expect((parsed.corpus.evidence[0] as Record<string, unknown>).reviewer_ids).toEqual(['r1']);
  });

  it('keeps null DOI as null instead of inventing one', () => {
    const parsed = importInputSchema.parse(buildSyntheticRun());
    expect(parsed.corpus.studies[1].doi).toBeNull();
  });

  it('defaults to no artifacts when none are supplied', () => {
    const { artifacts: _omitted, ...rest } = buildSyntheticRun();
    expect(importInputSchema.parse(rest).artifacts).toEqual({});
  });

  it('rejects a corpus missing required fields', () => {
    const input = buildSyntheticRun() as Record<string, any>;
    delete input.corpus.studies[0].title;
    expect(importInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an unknown artifact type', () => {
    const input = buildSyntheticRun() as Record<string, any>;
    input.run.artifacts[0].artifact_type = 'A99';
    expect(importInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('unwrapEnvelope', () => {
  it('unwraps {success, data}', () => {
    expect(unwrapEnvelope({ success: true, isSuccess: true, data: { a: 1 }, message: '' })).toEqual({ a: 1 });
  });

  it('returns a bare payload as is', () => {
    expect(unwrapEnvelope({ run_id: 'x' })).toEqual({ run_id: 'x' });
  });

  it('throws on an error envelope', () => {
    expect(() => unwrapEnvelope({ success: false, error: { code: 'X', message: 'no' } })).toThrow();
  });
});
