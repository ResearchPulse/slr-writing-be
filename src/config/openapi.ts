import type { OpenAPIV3 } from 'openapi-types';

export const openApiDocument: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'SLR Writing API',
    version: '0.1.0',
    description: 'Evidence-grounded manuscript writing from validated SLR output.',
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        responses: { '200': { description: 'Service is up' } },
      },
    },
  },
};
