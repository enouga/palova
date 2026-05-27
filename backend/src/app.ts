import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import courtsRouter from './routes/courts';
import reservationsRouter from './routes/reservations';
import { startCleanupJob } from './jobs/cleanup.job';
import { prisma } from './db/prisma';
import { redis } from './redis/client';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

app.use('/api/courts',       courtsRouter);
app.use('/api/reservations', reservationsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

if (require.main === module) {
  Promise.all([prisma.$connect(), redis.connect()])
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Backend démarré sur http://localhost:${PORT}`);
        startCleanupJob();
      });
    })
    .catch(console.error);
}

export default app;
