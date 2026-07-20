import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the server reads, validated once at boot.
 * Failing fast here beats discovering a missing secret on the first request
 * that happens to need it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // Exactly one of these two is needed; checked in the refinement below.
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  /**
   * Optional, like Cloudinary. Without it the writing assistant simply does not
   * appear — the app is fully usable without ever calling a model, and a
   * missing key must never be something a reader discovers by pressing a button
   * and getting an error.
   */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('manzil-recipe-vault'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Tests spin up their own in-memory Mongo and stub auth, so they must not be
  // held to the production credential requirements.
  const isTest = process.env.NODE_ENV === 'test';
  const source = isTest
    ? { MONGO_URI: 'mongodb://127.0.0.1:27017/test', ...process.env }
    : process.env;

  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Cloudinary is optional — image upload degrades gracefully without it. */
export const cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);
