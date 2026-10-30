import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'slr-writing-be', uptimeSeconds: Math.round(process.uptime()) } });
});

export default router;
