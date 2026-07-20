import mongoose from 'mongoose';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { initFirebase } from './config/firebase.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  initFirebase();

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info('Connected to MongoDB');

  // Builds any index declared on a schema but missing in the database. Cheap
  // when they already exist; without it the new text index never materialises.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));
  logger.info('Indexes synced');

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT}`);
  });

  setupGracefulShutdown(server);
}

/**
 * Stop accepting connections, let in-flight requests finish, then close the DB.
 * Platforms send SIGTERM before replacing a container; without this, requests
 * in flight are severed mid-response on every deploy.
 */
function setupGracefulShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);

    const force = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close(() => {
      void mongoose.connection.close(false).then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  // The old version logged a connection failure and left the process alive but
  // not listening, so the platform's health check saw a running zombie.
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
