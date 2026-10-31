import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRequest { method: string; url: string; authorization?: string }
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** A stand-in for slr-be on a random local port. Routes are exact paths (without query). */
export class FakeSlrBe {
  readonly requests: FakeRequest[] = [];
  private server!: Server;
  private routes = new Map<string, Handler>();
  baseUrl = '';

  async start() {
    this.server = createServer((req, res) => {
      this.requests.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization });
      const handler = this.routes.get((req.url ?? '').split('?')[0]);
      if (!handler) { res.statusCode = 404; res.end('{}'); return; }
      handler(req, res);
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() { return new Promise<void>((resolve) => { this.server.closeAllConnections(); this.server.close(() => resolve()); }); }
  reset() { this.routes.clear(); this.requests.length = 0; }

  on(path: string, handler: Handler) { this.routes.set(path, handler); }
  json(path: string, body: unknown, status = 200) {
    this.on(path, (_req, res) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
  }
  raw(path: string, text: string, status = 200) {
    this.on(path, (_req, res) => { res.statusCode = status; res.end(text); });
  }
  hang(path: string) { this.on(path, () => { /* never answers */ }); }
  redirect(path: string, to: string) { this.on(path, (_req, res) => { res.statusCode = 302; res.setHeader('location', to); res.end(); }); }

  /** Serves a whole synthetic run under the slr-be routes. `wrap` chooses the envelope style. */
  serveRun(slrProjectId: string, input: { run: any; corpus: any; artifacts: Record<string, unknown>; supplements?: { prisma_writing_export?: unknown; rq_findings?: unknown } }, wrap: (data: unknown) => unknown = (data) => ({ success: true, isSuccess: true, data, message: 'ok' })) {
    const base = `/api/projects/${slrProjectId}/synthesis/artifacts/runs/${input.run.run_id}`;
    this.json(base, wrap(input.run));
    this.json(`${base}/artifacts/corpus`, wrap(input.corpus));
    for (const [type, payload] of Object.entries(input.artifacts)) this.json(`${base}/artifacts/${type}`, wrap(payload));
    if (input.supplements?.prisma_writing_export) this.json(`/api/projects/${slrProjectId}/prisma/writing-export.json`, wrap(input.supplements.prisma_writing_export));
    if (input.supplements?.rq_findings) this.json(`/api/projects/${slrProjectId}/synthesis/findings`, wrap(input.supplements.rq_findings));
    return base;
  }
}
