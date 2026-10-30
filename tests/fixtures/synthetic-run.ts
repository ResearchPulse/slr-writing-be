/**
 * SYNTHETIC fixture shaped like a slr-be run (docs/slr-be-survey.md). Not real data: titles, quotes and hashes are invented.
 * Replace with a redacted real run once one is available.
 */
export function buildSyntheticRun(runId = 'run-20260101000000-abc123') {
  const corpusHash = 'corpus-hash-synthetic-1';
  const artifact = (type: string, over: Record<string, unknown> = {}) => ({
    artifact_type: type,
    artifact_id: `${type}-${runId}`,
    content_hash: `content-${type}`,
    review_status: 'approved',
    validation_status: 'valid',
    ...over,
  });

  return {
    run: {
      run_id: runId,
      project_id: 'slr-project-1',
      generated_at: '2026-01-01T00:00:00.000Z',
      generated_by: 'owner-uid',
      corpus_hash: corpusHash,
      corpus_version: 'slr-artifact-corpus-v2',
      generator_version: '1.1.0',
      artifacts: [artifact('A1'), artifact('A2'), artifact('A7'), artifact('A10')],
      reviews: [],
    },
    corpus: {
      corpus_version: 'slr-artifact-corpus-v2',
      corpus_hash: corpusHash,
      built_at: '2026-01-01T00:00:00.000Z',
      project_id: 'slr-project-1',
      project: { title: 'Synthetic review' },
      research_questions: [
        { rq_id: 'rq-1', code: 'RQ1', question: 'What interventions improve outcome X?' },
      ],
      studies: [
        {
          study_id: 'paper-1', title: 'Synthetic study one', authors: ['A. Author', 'B. Author'], year: 2021,
          doi: '10.0000/synthetic.1', venue: 'Synthetic Journal', keywords: ['alpha', 'beta'],
          extraction: { status: 'COMPLETED' }, document_ids: ['doc-1'],
        },
        {
          study_id: 'paper-2', title: 'Synthetic study two', authors: ['C. Author'], year: 2022,
          doi: null, venue: null, keywords: [],
          extraction: { status: 'COMPLETED' }, document_ids: ['doc-2'],
        },
      ],
      documents: [
        { document_id: 'doc-1', study_id: 'paper-1', kind: 'fulltext_markdown', source_revisions: ['rev-1'], source_hashes: ['hash-doc-1'] },
        { document_id: 'doc-2', study_id: 'paper-2', kind: 'fulltext_markdown', source_revisions: ['rev-1'], source_hashes: ['hash-doc-2'] },
      ],
      findings: [
        {
          finding_id: 'F:paper-1:f-outcome', study_id: 'paper-1', field_id: 'f-outcome', field_name: 'Outcome',
          section_name: 'Results', role: 'outcome', value_text: 'Improved by 12%', is_not_reported: false,
          evidence_ids: ['ev-1'],
        },
        {
          finding_id: 'F:paper-2:f-outcome', study_id: 'paper-2', field_id: 'f-outcome', field_name: 'Outcome',
          section_name: 'Results', role: 'outcome', value_text: 'Not reported', is_not_reported: true,
          evidence_ids: [],
        },
      ],
      evidence: [
        {
          evidence_id: 'ev-1', study_id: 'paper-1', field_id: 'f-outcome', finding_ids: ['F:paper-1:f-outcome'],
          document_id: 'doc-1', source_revision: 'rev-1', source_hash: 'hash-doc-1',
          source_location: { page: 5, section: 'Results', paragraph: 12, table_or_figure: null, char_start: 10, char_end: 60 },
          quote: 'The intervention improved the outcome by 12 percent.', quote_hash: 'qhash-1', quote_hash_verified: true,
          reviewer_ids: ['r1'], consensus_value_match: 'match',
        },
      ],
      claims: [
        {
          claim_id: 'claim-1', origin: 'researcher_theme', title: 'Intervention helps', description: null,
          research_question_id: 'rq-1',
          items: [
            {
              item_id: 'item-1', extracted_data_value_id: 'v1', link_status: 'resolved',
              unresolved_reason: null, finding_id: 'F:paper-1:f-outcome', study_id: 'paper-1',
              value_drift: 'unchanged', notes: null,
            },
          ],
        },
      ],
      quality: [],
      issues: [],
    },
    artifacts: {
      A1: { artifact_id: `A1-${runId}`, artifact_type: 'A1', schema_version: '1.0.0', rows: [] },
      A2: { artifact_id: `A2-${runId}`, artifact_type: 'A2', schema_version: '1.0.0' },
      A7: { artifact_id: `A7-${runId}`, artifact_type: 'A7', schema_version: '1.0.0', entries: [] },
      A10: { artifact_id: `A10-${runId}`, artifact_type: 'A10', schema_version: '1.0.0' },
    },
  };
}
