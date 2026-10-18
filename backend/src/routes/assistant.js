import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { askAssistant, AssistantConfigError } from '../services/assistantService.js';

const router = Router();

// Each question can trigger several paid model calls, so keep a tighter limit than the rest of the API.
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions. Please wait a minute.' },
}));

const bodySchema = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional(),
});

// POST /api/assistant  (auth enforced where the router is mounted)
router.post('/', async (req, res, next) => {
  try {
    const { question, history } = bodySchema.parse(req.body);
    const result = await askAssistant(question, history);
    console.log(`[Assistant] user=${req.user?.email ?? '?'} tools=${result.trace.map((t) => t.tool).join(',') || 'none'} q=${JSON.stringify(question).slice(0, 200)}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid request' });
    if (err instanceof AssistantConfigError) return res.status(503).json({ error: 'The AI assistant is not configured on the server yet.' });
    next(err);
  }
});

export default router;
