import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
  // Pretty output is a dev-only nicety; production ships newline-delimited JSON
  // so the hosting platform can parse it.
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
  base: { env: env.NODE_ENV },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.api_secret', '*.private_key'],
    censor: '[redacted]',
  },
});
