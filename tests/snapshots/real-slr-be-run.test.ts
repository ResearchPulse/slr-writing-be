import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessReadiness } from '../../src/modules/snapshots/snapshot-readiness.js';
import { importInputSchema } from '../../src/modules/snapshots/slr-source.schemas.js';

/**
 * A run exported from a real slr-be (development seed project `proj_slr_artifacts_demo`, public papers, seed user ids only).
 * It is the first non-synthetic input; these tests pin down what the real service actually returns.
 */
const raw = JSON.parse(readFileSync(new URL('../fixtures/real/slr-be-demo-run.json', import.meta.url), 'utf8'));
const input = importInputSchema.parse(raw);

describe('a real slr-be run', () => {
  it('matches the input contract', () => {
    expect(input.run.run_id).toMatch(/^run-\d{14}-[a-z0-9]{6}$/);
    expect(input.run.corpus_hash).toBe(input.corpus.corpus_hash);
    expect(Object.keys(input.artifacts).sort()).toEqual(['A1', 'A10', 'A2', 'A7']);
  });

  it('is ready to import, with warnings about the missing full-text evidence', () => {
    const report = assessReadiness(input);
    expect(report.status).toBe('READY');
    expect(report.issues.filter((i) => i.severity === 'blocking')).toEqual([]);
    expect(report.issues.map((i) => i.code)).toContain('NO_EVIDENCE');
  });

  it('shows what the real service returns that the synthetic fixture did not assume', () => {
    // Artifacts that need no validation come back as not_applicable, not valid.
    expect(input.run.artifacts.find((a) => a.artifact_type === 'A1')?.validation_status).toBe('not_applicable');
    // Studies without full text give no documents and no evidence, yet findings and claims exist.
    expect(input.corpus.documents).toHaveLength(0);
    expect(input.corpus.evidence).toHaveLength(0);
    expect(input.corpus.findings.length).toBeGreaterThan(0);
    expect(input.corpus.claims.length).toBeGreaterThan(0);
  });

  it('has the A10 protocol content, but A10 carries no PRISMA numbers for this project', () => {
    const a10 = input.artifacts.A10 as Record<string, any>;
    expect(a10.protocol.research_questions).toHaveLength(3);
    expect(a10.protocol.inclusion_criteria.length).toBeGreaterThan(0);
    expect(a10.selected_studies).toHaveLength(input.corpus.studies.length);
    expect(a10.extraction_data.finding_count).toBe(input.corpus.findings.length);
    // A10 copies these as stored and the demo project never filled them in.
    expect(a10.selection.prisma).toBeNull();
    expect(a10.search_strategy.sources).toEqual([]);
  });

  it('gets the PRISMA flow from the separate writing export, which agrees with the corpus', () => {
    const prisma = input.supplements.prisma_writing_export!;
    expect(prisma.schemaVersion).toBe('slr-prisma-writing-v1');
    expect(prisma.flow.studiesIncluded).toBe(input.corpus.studies.length);
    expect(assessReadiness(input).issues.map((i) => i.code)).not.toContain('PRISMA_COUNT_MISMATCH');
  });

  it('has A1 rows that point at known claims', () => {
    const a1 = input.artifacts.A1 as Record<string, any>;
    expect(a1.rows.length).toBe(input.corpus.claims.length);
  });
});
