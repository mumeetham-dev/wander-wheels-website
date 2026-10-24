import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { prisma } from './db.js';
import { fail } from './lib/http.js';
import { publicRouter } from './routes/public.js';
import { adminAuthRouter } from './routes/adminAuth.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5173';

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: [FRONTEND_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// Local uploads from the admin media endpoint (see routes/admin.js).
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/api/v1/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ok', db: 'connected' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Database unavailable', code: 'INTERNAL_ERROR' });
  }
});

app.use('/api/v1', publicRouter);
app.use('/api/v1/admin/auth', adminAuthRouter);
app.use('/api/v1/admin', adminRouter);

// Multer/file-filter rejections land here as plain Errors. Everything else is
// a server fault: log it, return a generic code, never leak internals.
app.use((err, _req, res, _next) => {
  if (err) {
    console.error(err);
    const clientError =
      typeof err.message === 'string' &&
      (/^Only image/.test(err.message) || String(err.code || '').startsWith('LIMIT_'));
    if (clientError) return fail(res, 400, err.message, 'VALIDATION_ERROR');
    return fail(res, 500, 'Something went wrong.', 'INTERNAL_ERROR');
  }
  return fail(res, 500, 'Something went wrong.', 'INTERNAL_ERROR');
});

app.use((req, res) => {
  res.status(404).json({ message: 'Not found', code: 'NOT_FOUND' });
});

app.listen(PORT, () => {
  console.log(`wander-wheels-backend listening on http://localhost:${PORT}`);
});
