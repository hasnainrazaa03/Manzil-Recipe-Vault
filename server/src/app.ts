import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import mongoose from 'mongoose';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { AppError } from './lib/errors.js';
import recipeRoutes from './routes/recipes.js';
import userRoutes from './routes/users.js';
import uploadRoutes from './routes/upload.js';
import collectionRoutes from './routes/collections.js';
import socialRoutes from './routes/social.js';
import shoppingListRoutes from './routes/shopping-list.js';

/**
 * Builds the Express app without starting it or touching the database, so
 * tests can mount it against an in-memory Mongo instance.
 */
export function createApp(): Express {
  const app = express();

  // Hosting platforms (Render, Railway, Fly) terminate TLS upstream. Without
  // this, every client looks like it shares the proxy's IP and rate limiting
  // buckets the whole world together.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server requests arrive without an Origin.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(new AppError(403, 'Origin not allowed', 'cors_rejected'));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  );

  // A recipe with 20k characters of instructions is ~40 kB; 256 kB is generous
  // and still bounds what one request can cost us.
  app.use(express.json({ limit: '256kb' }));

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks fire constantly and say nothing.
        autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
      }),
    );
  }

  /** Liveness/readiness probe for the hosting platform. */
  app.get('/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const healthy = dbState === 1;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown',
      uptime: Math.round(process.uptime()),
    });
  });

  app.get('/', (_req, res) => {
    res.json({ name: 'Manzil Recipe Vault API', version: 1 });
  });

  app.use('/api/recipes', recipeRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/collections', collectionRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/shopping-list', shoppingListRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
