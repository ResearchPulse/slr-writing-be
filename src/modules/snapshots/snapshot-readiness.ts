import type { ImportInput } from './slr-source.schemas.js';

export type ReadinessSeverity = 'blocking' | 'warning';

export interface ReadinessIssue {
  code: string;
  severity: ReadinessSeverity;
  message: string;
  ref?: string;
}

export interface ReadinessReport {
  /** READY only when there is no blocking issue. Warnings do not block. */
  status: 'READY' | 'BLOCKED';
  issues: ReadinessIssue[];
}

/** MVP reads Results from A1 and Methods/PRISMA from A10 (docs/mvp-scope.md), so they must be usable. */
const REQUIRED_ARTIFACTS = ['A1', 'A10'] as const;
/** Describe the corpus (A2) and feed Discussion (A7). Missing ones weaken the paper but do not stop it. */
const OPTIONAL_ARTIFACTS = ['A2', 'A7'] as const;

/**
 * Decides whether an imported run is complete and consistent enough to write from.
 * Missing data is reported, never filled in. Pure function: no I/O.
 */
export function assessReadiness(input: ImportInput): ReadinessReport {
  const issues: ReadinessIssue[] = [];
  const block = (code: string, message: string, ref?: string) => issues.push({ code, severity: 'blocking', message, ref });
  const warn = (code: string, message: string, ref?: string) => issues.push({ code, severity: 'warning', message, ref });
  const { run, corpus } = input;

  if (run.corpus_hash !== corpus.corpus_hash) {
    block('CORPUS_HASH_MISMATCH', 'The run and the corpus carry different corpus hashes', run.run_id);
  }
  if (corpus.research_questions.length === 0) block('NO_RESEARCH_QUESTIONS', 'The review has no research questions');
  if (corpus.studies.length === 0) block('NO_STUDIES', 'The corpus has no included studies');

  // One row per artifact type is stored, so a run that lists a type twice, or a payload that is not the listed artifact, cannot be imported.
  const listedTypes = run.artifacts.map((artifact) => artifact.artifact_type);
  for (const type of new Set(listedTypes.filter((value, index) => listedTypes.indexOf(value) !== index))) {
    block('DUPLICATE_ID', 'The run lists this artifact type more than once', type);
  }
  for (const [type, payload] of Object.entries(input.artifacts)) {
    const listed = run.artifacts.find((artifact) => artifact.artifact_type === type);
    if (listed && payload && payload.artifact_id !== listed.artifact_id) {
      block('ARTIFACT_ID_MISMATCH', `The content supplied for ${type} is not the artifact listed in the run`, type);
    }
  }

  for (const type of REQUIRED_ARTIFACTS) {
    const summary = run.artifacts.find((artifact) => artifact.artifact_type === type);
    if (!summary) {
      block('ARTIFACT_MISSING', `Required artifact ${type} is not part of the run`, type);
    } else if (summary.validation_status === 'invalid') {
      block('ARTIFACT_INVALID', `Artifact ${type} failed validation`, type);
    } else if (summary.review_status === 'rejected') {
      block('ARTIFACT_REJECTED', `Artifact ${type} was rejected by a reviewer`, type);
    } else if (summary.review_status !== 'approved') {
      block('ARTIFACT_NOT_APPROVED', `Artifact ${type} is ${summary.review_status}, not approved`, type);
    } else if (!input.artifacts[type]) {
      block('ARTIFACT_PAYLOAD_MISSING', `Artifact ${type} is listed in the run but its content was not supplied`, type);
    }
  }
  for (const type of OPTIONAL_ARTIFACTS) {
    const summary = run.artifacts.find((artifact) => artifact.artifact_type === type);
    if (!summary || !input.artifacts[type]) warn('OPTIONAL_ARTIFACT_MISSING', `Optional artifact ${type} is not available`, type);
    else if (summary.validation_status === 'invalid' || summary.review_status !== 'approved') {
      warn('OPTIONAL_ARTIFACT_NOT_USABLE', `Optional artifact ${type} is ${summary.review_status} / ${summary.validation_status}`, type);
    }
  }

  // Referential integrity: the adapter must be able to link every row it stores.
  const studyIds = new Set(corpus.studies.map((study) => study.study_id));
  const documentIds = new Set(corpus.documents.map((document) => document.document_id));
  const findingIds = new Set(corpus.findings.map((finding) => finding.finding_id));
  const evidenceIds = new Set(corpus.evidence.map((evidence) => evidence.evidence_id));
  const rqIds = new Set(corpus.research_questions.map((rq) => rq.rq_id));

  const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);
  for (const [label, ids] of [
    ['study', corpus.studies.map((s) => s.study_id)],
    ['document', corpus.documents.map((d) => d.document_id)],
    ['finding', corpus.findings.map((f) => f.finding_id)],
    ['evidence', corpus.evidence.map((e) => e.evidence_id)],
    ['claim', corpus.claims.map((c) => c.claim_id)],
    ['research question', corpus.research_questions.map((q) => q.rq_id)],
  ] as const) {
    for (const id of new Set(duplicates([...ids]))) block('DUPLICATE_ID', `Duplicate ${label} id`, id);
  }

  for (const document of corpus.documents) {
    if (!studyIds.has(document.study_id)) block('UNKNOWN_STUDY', 'Document points to an unknown study', document.document_id);
  }
  for (const finding of corpus.findings) {
    if (!studyIds.has(finding.study_id)) block('UNKNOWN_STUDY', 'Finding points to an unknown study', finding.finding_id);
    for (const id of finding.evidence_ids) {
      if (!evidenceIds.has(id)) block('UNKNOWN_EVIDENCE', 'Finding points to unknown evidence', `${finding.finding_id} -> ${id}`);
    }
  }
  for (const evidence of corpus.evidence) {
    if (!studyIds.has(evidence.study_id)) block('UNKNOWN_STUDY', 'Evidence points to an unknown study', evidence.evidence_id);
    if (!documentIds.has(evidence.document_id)) block('UNKNOWN_DOCUMENT', 'Evidence points to an unknown document', evidence.evidence_id);
    for (const id of evidence.finding_ids) {
      if (!findingIds.has(id)) block('UNKNOWN_FINDING', 'Evidence points to an unknown finding', `${evidence.evidence_id} -> ${id}`);
    }
  }
  for (const claim of corpus.claims) {
    if (claim.research_question_id && !rqIds.has(claim.research_question_id)) {
      block('UNKNOWN_RESEARCH_QUESTION', 'Claim points to an unknown research question', claim.claim_id);
    }
    for (const id of new Set(duplicates(claim.items.map((item) => item.item_id)))) {
      block('DUPLICATE_ID', 'Duplicate claim item id', `${claim.claim_id}/${id}`);
    }
    for (const item of claim.items) {
      if (item.finding_id && !findingIds.has(item.finding_id)) {
        block('UNKNOWN_FINDING', 'Claim item points to an unknown finding', `${claim.claim_id}/${item.item_id}`);
      }
      if (item.study_id && !studyIds.has(item.study_id)) {
        block('UNKNOWN_STUDY', 'Claim item points to an unknown study', `${claim.claim_id}/${item.item_id}`);
      }
    }
  }

  // Methods needs the PRISMA flow, which slr-be keeps outside the run. Compare it with the frozen corpus to catch a moved project.
  const prisma = input.supplements?.prisma_writing_export;
  if (!prisma) warn('PRISMA_EXPORT_MISSING', 'The PRISMA writing export was not supplied, so the Methods section has no flow counts');
  else if ((prisma.flow.studiesIncluded ?? prisma.includedStudies.length) !== corpus.studies.length) {
    warn('PRISMA_COUNT_MISMATCH', `The PRISMA export counts ${prisma.flow.studiesIncluded ?? prisma.includedStudies.length} included studies but the run corpus has ${corpus.studies.length}`);
  }

  // A review without full-text evidence can still support Methods, but nothing can be quoted or cited at passage level.
  // Seen on real slr-be data: studies imported without full text give 0 documents and 0 evidence, and the run is otherwise valid.
  if (corpus.evidence.length === 0) warn('NO_EVIDENCE', 'The corpus has no evidence quotes, so findings cannot be traced to a passage in the source');
  if (corpus.claims.length === 0) warn('NO_CLAIMS', 'The corpus has no synthesis themes, so the Results section has nothing to build on');

  // Quality of the evidence base: worth showing to the user, not worth blocking on.
  for (const study of corpus.studies) {
    if (study.extraction.status !== 'COMPLETED') warn('EXTRACTION_INCOMPLETE', 'Data extraction is not completed for this study', study.study_id);
  }
  for (const evidence of corpus.evidence) {
    if (!evidence.quote_hash_verified) warn('QUOTE_NOT_VERIFIED', 'The quote hash was not verified against the source', evidence.evidence_id);
    if (evidence.consensus_value_match === 'mismatch') warn('CONSENSUS_MISMATCH', 'The quote supports a different value than the consensus', evidence.evidence_id);
  }
  for (const claim of corpus.claims) {
    for (const item of claim.items) {
      if (item.link_status === 'unresolved') warn('CLAIM_ITEM_UNRESOLVED', 'A theme cites a value that does not resolve', `${claim.claim_id}/${item.item_id}`);
      if (item.value_drift === 'changed') warn('VALUE_DRIFT', 'The cited value changed since the theme cited it', `${claim.claim_id}/${item.item_id}`);
    }
  }
  for (const issue of corpus.issues) warn('CORPUS_ISSUE', `${issue.code}: ${issue.message}`);

  return { status: issues.some((issue) => issue.severity === 'blocking') ? 'BLOCKED' : 'READY', issues };
}
