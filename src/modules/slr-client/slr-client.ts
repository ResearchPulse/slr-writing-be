import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  artifactPayloadSchema, corpusSchema, runSchema, unwrapEnvelope,
  type ArtifactTypeName, type ImportInput,
} from '../snapshots/slr-source.schemas.js';

/** Artifacts the MVP writes from (docs/mvp-scope.md). Others are not fetched. */
export const MVP_ARTIFACT_TYPES: ArtifactTypeName[] = ['A1', 'A2', 'A7', 'A10'];

/** slr-be run ids look like `run-20260101120000-ab12cd`; reject anything else before it reaches a URL. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const isValidRunId = (value: unknown): value is string => typeof value === 'string' && RUN_ID_PATTERN.test(value);

export interface SlrClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SlrRequestContext {
  /** The user's `Authorization` header value, forwarded as is (ADR-001). Omitted when the caller has none. */
  authorization?: string;
}

const upstreamError = (status: number, code: string, message: string) => new AppError(message, status, code);

/**
 * Reads one run of a project from slr-be, with the caller's own token.
 * Upstream failures become our own errors; upstream bodies and URLs are never echoed to the client.
 */
export class SlrClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SlrClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.SLR_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? env.SLR_API_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get(path: string, ctx: SlrRequestContext): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (ctx.authorization) headers.Authorization = ctx.authorization;

    let response: Response;
    try {
      // `redirect: 'error'` so the user's token is never forwarded to a host we did not choose.
      response = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw upstreamError(504, 'SLR_TIMEOUT', 'slr-be did not answer in time');
      }
      throw upstreamError(502, 'SLR_UNREACHABLE', 'slr-be could not be reached');
    }

    if (response.status === 401) throw upstreamError(401, 'SLR_AUTH_REJECTED', 'slr-be rejected the token');
    if (response.status === 403) throw upstreamError(403, 'SLR_FORBIDDEN', 'You do not have access to this SLR project');
    if (response.status === 404) throw upstreamError(404, 'SLR_NOT_FOUND', 'The SLR project, run or artifact was not found');
    if (!response.ok) throw upstreamError(502, 'SLR_UPSTREAM_ERROR', `slr-be answered with status ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Includes a body cut off by the timeout.
      throw upstreamError(502, 'SLR_INVALID_RESPONSE', 'slr-be returned a body that is not valid JSON');
    }
    try {
      return unwrapEnvelope(body);
    } catch {
      throw upstreamError(502, 'SLR_UPSTREAM_ERROR', 'slr-be reported an error');
    }
  }

  private async getParsed<T>(path: string, ctx: SlrRequestContext, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
    const parsed = schema.safeParse(await this.get(path, ctx));
    if (!parsed.success) throw upstreamError(502, 'SLR_INVALID_RESPONSE', `slr-be returned an unexpected shape for ${path.split('/').pop()}`);
    return parsed.data;
  }

  /** Fetches the run, its own corpus and the MVP artifacts it contains, in the shape the importer expects. */
  async fetchRun(slrProjectId: string, runId: string, ctx: SlrRequestContext = {}): Promise<ImportInput> {
    if (!isValidRunId(runId)) throw new AppError('Invalid run id', 400, 'INVALID_RUN_ID');
    const base = `/projects/${encodeURIComponent(slrProjectId)}/synthesis/artifacts/runs/${encodeURIComponent(runId)}`;

    const run = await this.getParsed(base, ctx, runSchema);
    if (run.run_id !== runId) throw upstreamError(502, 'SLR_INVALID_RESPONSE', 'slr-be returned a different run than requested');

    // The run's own corpus is the frozen one; the live `/artifacts/corpus` could already have moved on.
    const corpus = await this.getParsed(`${base}/artifacts/corpus`, ctx, corpusSchema);

    const wanted = MVP_ARTIFACT_TYPES.filter((type) => run.artifacts.some((artifact) => artifact.artifact_type === type));
    const fetched = await Promise.all(wanted.map(async (type) => [type, await this.getParsed(`${base}/artifacts/${type}`, ctx, artifactPayloadSchema)] as const));

    const artifacts: ImportInput['artifacts'] = {};
    for (const [type, payload] of fetched) {
      if (payload.artifact_type !== type) throw upstreamError(502, 'SLR_INVALID_RESPONSE', `slr-be returned ${payload.artifact_type} where ${type} was requested`);
      artifacts[type] = payload;
    }
    return { run, corpus, artifacts };
  }
}
