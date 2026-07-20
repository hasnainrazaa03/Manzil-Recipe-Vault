import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, AppError } from '../lib/errors.js';
import { cloudinaryConfigured, env } from '../config/env.js';
import { uploadSignatureBody } from '../schemas/user.js';

const router = Router();

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/** Only these reach Cloudinary, and only these are signed. */
const ALLOWED_FORMATS = 'jpg,jpeg,png,webp,gif';

/**
 * POST /api/upload/signature
 *
 * Mints a short-lived, *constrained* Cloudinary upload signature.
 *
 * The previous version signed `{timestamp, upload_preset}` and nothing else,
 * while the client posted to `/auto/upload` — so a valid signature authorised
 * an upload of any resource type, any size, to any folder, including video and
 * raw binaries. Pinning `folder` and `allowed_formats` into the signed params
 * means Cloudinary itself rejects anything outside those bounds, because the
 * client cannot alter a signed parameter without invalidating the signature.
 */
router.post(
  '/signature',
  requireAuth,
  uploadLimiter,
  validate({ body: uploadSignatureBody }),
  asyncHandler(async (req, res) => {
    if (!cloudinaryConfigured) {
      throw new AppError(503, 'Image uploads are not configured on this server', 'upload_unavailable');
    }

    const user = requireUser(req);
    const { kind } = req.body as { kind: 'recipe' | 'avatar' };

    // Scoping the folder per user keeps one account's uploads from colliding
    // with another's and makes abuse traceable and cheap to purge.
    const folder = `${env.CLOUDINARY_UPLOAD_FOLDER}/${kind === 'avatar' ? 'avatars' : 'recipes'}/${user.uid}`;

    const timestamp = Math.round(Date.now() / 1000);

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      allowed_formats: ALLOWED_FORMATS,
      // Bound stored dimensions; a 40 MP upload becomes a sane image on ingest.
      transformation: kind === 'avatar' ? 'c_limit,w_512,h_512' : 'c_limit,w_2000,h_2000',
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET!);

    res.json({
      signature,
      timestamp,
      folder,
      allowedFormats: ALLOWED_FORMATS,
      transformation: paramsToSign.transformation,
      apiKey: env.CLOUDINARY_API_KEY,
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      // The client must post to the image endpoint; `auto` would let a caller
      // smuggle in a non-image resource type.
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    });
  }),
);

export default router;
