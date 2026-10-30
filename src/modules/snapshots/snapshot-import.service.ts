import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ReviewSnapshot } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors/app-error.js';
import { assessReadiness, type ReadinessReport } from './snapshot-readiness.js';
import { importInputSchema, type ImportInput } from './slr-source.schemas.js';

export const IMPORT_METHOD = 'slr-be-adapter@1';

export class SnapshotNotReadyError extends AppError {
  constructor(public readonly report: ReadinessReport) {
    super('The run has blocking issues and cannot be imported', 422, 'SNAPSHOT_NOT_READY');
  }
}

export interface ImportResult {
  snapshot: ReviewSnapshot;
  /** False when the same run and corpus hash had already been imported. */
  created: boolean;
  readiness: ReadinessReport;
}

/** JSON with sorted keys, so the same content always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const computeIntegrityHash = (input: ImportInput): string =>
  `sha256:${createHash('sha256').update(stableStringify({ corpus: input.corpus, artifacts: input.artifacts })).digest('hex')}`;

function parseInput(raw: unknown): ImportInput {
  const parsed = importInputSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
    throw new BadRequestError(`Invalid import payload: ${detail}`, 'INVALID_IMPORT_INPUT');
  }
  return parsed.data;
}

/** Dry run: parse and assess a run without storing anything. */
export function validateImport(raw: unknown): ReadinessReport {
  return assessReadiness(parseInput(raw));
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Stores one slr-be run as an immutable snapshot (ADR-005).
 * - A run with blocking issues is rejected and nothing is stored.
 * - Importing the same run with the same corpus hash again returns the existing snapshot.
 */
export async function importSnapshot(params: { projectId: string; importedBy: string; input: unknown }): Promise<ImportResult> {
  const project = await prisma.project.findUnique({ where: { id: params.projectId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

  const input = parseInput(params.input);
  if (input.run.project_id !== project.slrProjectId || input.corpus.project_id !== project.slrProjectId) {
    throw new BadRequestError('The run belongs to a different SLR project', 'RUN_PROJECT_MISMATCH');
  }

  const readiness = assessReadiness(input);
  if (readiness.status === 'BLOCKED') throw new SnapshotNotReadyError(readiness);

  const where = {
    projectId_sourceRunId_corpusHash: { projectId: project.id, sourceRunId: input.run.run_id, corpusHash: input.corpus.corpus_hash },
  };
  const existing = await prisma.reviewSnapshot.findUnique({ where });
  if (existing) return { snapshot: existing, created: false, readiness };

  try {
    const snapshot = await prisma.$transaction((tx) => store(tx, project.id, params.importedBy, input, readiness), { timeout: 60_000 });
    return { snapshot, created: true, readiness };
  } catch (error) {
    // Two imports of the same run can race; the unique key makes the loser read the winner's snapshot.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.reviewSnapshot.findUnique({ where });
      if (winner) return { snapshot: winner, created: false, readiness };
    }
    throw error;
  }
}

async function store(
  tx: Prisma.TransactionClient,
  projectId: string,
  importedBy: string,
  input: ImportInput,
  readiness: ReadinessReport,
): Promise<ReviewSnapshot> {
  const { run, corpus } = input;
  const snapshot = await tx.reviewSnapshot.create({
    data: {
      projectId,
      sourceRunId: run.run_id,
      corpusHash: corpus.corpus_hash,
      corpusVersion: corpus.corpus_version,
      generatorVersion: run.generator_version,
      status: 'READY',
      integrityHash: computeIntegrityHash(input),
      importedBy,
      issues: json(readiness.issues),
    },
  });
  const snapshotId = snapshot.id;

  // Ids are generated here so every foreign key can be filled in without reading rows back.
  const ids = <T>(items: T[], key: (item: T) => string) => new Map(items.map((item) => [key(item), randomUUID()]));
  const rqIds = ids(corpus.research_questions, (rq) => rq.rq_id);
  const studyIds = ids(corpus.studies, (study) => study.study_id);
  const documentIds = ids(corpus.documents, (document) => document.document_id);
  const findingIds = ids(corpus.findings, (finding) => finding.finding_id);
  const evidenceIds = ids(corpus.evidence, (evidence) => evidence.evidence_id);
  const claimIds = ids(corpus.claims, (claim) => claim.claim_id);
  // Readiness already guaranteed every reference below resolves.
  const get = (map: Map<string, string>, key: string) => map.get(key)!;

  await tx.researchQuestion.createMany({
    data: corpus.research_questions.map((rq) => ({
      id: get(rqIds, rq.rq_id), snapshotId, externalId: rq.rq_id, code: rq.code, text: rq.question,
    })),
  });
  await tx.study.createMany({
    data: corpus.studies.map((study) => ({
      id: get(studyIds, study.study_id), snapshotId, externalId: study.study_id, title: study.title,
      authors: study.authors, year: study.year, doi: study.doi, venue: study.venue, keywords: study.keywords,
      extractionStatus: study.extraction.status,
    })),
  });
  await tx.sourceDocument.createMany({
    data: corpus.documents.map((document) => ({
      id: get(documentIds, document.document_id), snapshotId, studyId: get(studyIds, document.study_id),
      externalId: document.document_id, kind: document.kind,
      sourceRevisions: document.source_revisions, sourceHashes: document.source_hashes,
    })),
  });
  await tx.extractedFinding.createMany({
    data: corpus.findings.map((finding) => ({
      id: get(findingIds, finding.finding_id), snapshotId, studyId: get(studyIds, finding.study_id),
      externalId: finding.finding_id, fieldId: finding.field_id, fieldName: finding.field_name,
      sectionName: finding.section_name, role: finding.role, valueText: finding.value_text,
      isNotReported: finding.is_not_reported,
    })),
  });
  await tx.evidence.createMany({
    data: corpus.evidence.map((evidence) => ({
      id: get(evidenceIds, evidence.evidence_id), snapshotId, studyId: get(studyIds, evidence.study_id),
      documentId: get(documentIds, evidence.document_id), externalId: evidence.evidence_id,
      fieldId: evidence.field_id, sourceRevision: evidence.source_revision, sourceHash: evidence.source_hash,
      quote: evidence.quote, quoteHash: evidence.quote_hash, quoteHashVerified: evidence.quote_hash_verified,
      page: evidence.source_location.page, section: evidence.source_location.section,
      paragraph: evidence.source_location.paragraph, tableOrFigure: evidence.source_location.table_or_figure,
      charStart: evidence.source_location.char_start ?? null, charEnd: evidence.source_location.char_end ?? null,
      consensusMatch: evidence.consensus_value_match,
    })),
  });

  // The link between evidence and findings is recorded on both sides in slr-be; keep the union.
  const links = new Set<string>();
  for (const evidence of corpus.evidence) for (const id of evidence.finding_ids) links.add(`${evidence.evidence_id}\u0000${id}`);
  for (const finding of corpus.findings) for (const id of finding.evidence_ids) links.add(`${id}\u0000${finding.finding_id}`);
  await tx.evidenceFinding.createMany({
    data: [...links].map((link) => {
      const [evidenceId, findingId] = link.split('\u0000');
      return { evidenceId: get(evidenceIds, evidenceId), findingId: get(findingIds, findingId) };
    }),
  });

  await tx.claim.createMany({
    data: corpus.claims.map((claim) => ({
      id: get(claimIds, claim.claim_id), snapshotId, externalId: claim.claim_id, title: claim.title,
      description: claim.description,
      researchQuestionId: claim.research_question_id ? get(rqIds, claim.research_question_id) : null,
    })),
  });
  await tx.claimItem.createMany({
    data: corpus.claims.flatMap((claim) => claim.items.map((item) => ({
      claimId: get(claimIds, claim.claim_id), externalId: item.item_id,
      findingId: item.finding_id ? get(findingIds, item.finding_id) : null,
      studyId: item.study_id ? get(studyIds, item.study_id) : null,
      linkStatus: item.link_status, valueDrift: item.value_drift, notes: item.notes,
    }))),
  });

  await tx.snapshotArtifact.createMany({
    data: run.artifacts.flatMap((summary) => {
      const payload = input.artifacts[summary.artifact_type];
      if (!payload) return [];
      return [{
        snapshotId, artifactType: summary.artifact_type, artifactId: summary.artifact_id,
        schemaVersion: payload.schema_version, contentHash: summary.content_hash,
        reviewStatus: summary.review_status, validationStatus: summary.validation_status, payload: json(payload),
      }];
    }),
  });

  await tx.provenanceEvent.create({
    data: {
      projectId, snapshotId, actor: importedBy, activity: 'snapshot.import', method: IMPORT_METHOD,
      inputRefs: json({ sourceRunId: run.run_id, corpusHash: corpus.corpus_hash, sourceProjectId: run.project_id }),
      outputRefs: json({ snapshotId }),
      notes: `${readiness.issues.length} warning(s)`,
    },
  });

  return snapshot;
}
