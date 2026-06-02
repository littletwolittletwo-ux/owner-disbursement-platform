import express from 'express';
import cors from 'cors';

// Vercel injects env vars automatically - patch DATABASE_URL from POSTGRES_URL
if (!process.env.DATABASE_URL && process.env.POSTGRES_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL;
}

const { router } = await import('../backend/src/routes.js');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api', router);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

export default app;
