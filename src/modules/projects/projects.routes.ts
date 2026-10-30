import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validation.middleware.js';
import type { AuthenticatedRequest } from '../../shared/types/common.types.js';
import snapshotRoutes from '../snapshots/snapshots.routes.js';
import { createProject, getOwnedProject, listProjects } from './projects.service.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200),
    slrProjectId: z.string().trim().min(1).max(200),
  }),
});

router.post('/', validate(createSchema), async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await createProject(req.user!.uid, req.body);
    return res.status(201).json({ success: true, data: project });
  } catch (error) { return next(error); }
});

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    return res.json({ success: true, data: await listProjects(req.user!.uid) });
  } catch (error) { return next(error); }
});

router.get('/:projectId', async (req: AuthenticatedRequest, res, next) => {
  try {
    return res.json({ success: true, data: await getOwnedProject(req.user!.uid, req.params.projectId) });
  } catch (error) { return next(error); }
});

router.use('/:projectId/snapshots', snapshotRoutes);

export default router;
