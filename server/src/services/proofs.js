/**
 * Application-proof screenshots.
 *
 * A student proves they applied by uploading the confirmation screen. Those
 * images routinely contain a full name, a personal email, an application
 * reference and sometimes a phone number — so unlike profile photos they are
 * NOT written into the public `/uploads` tree. They live in `server/private/`,
 * which nothing serves statically, and reach the browser only through
 * `GET /api/jobs/applications/:id/proof`, which checks that the caller either
 * owns the application or is an admin.
 *
 * The file is re-encoded through sharp rather than stored as uploaded. That
 * normalises the format, caps the dimensions, and drops EXIF — which on a phone
 * screenshot can carry a GPS fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROOF_DIR = path.resolve(here, '../../private/proofs');

// Wide enough that a portal confirmation stays readable when an officer opens
// it, small enough that 600 students cannot fill the disk.
const MAX_EDGE = 1600;

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

fs.mkdirSync(PROOF_DIR, { recursive: true });

export function proofLimits() {
  return { maxBytes: Math.round(env.jobs.proofMaxMb * 1024 * 1024), maxMb: env.jobs.proofMaxMb };
}

/**
 * Store one screenshot. Returns `{ ok, filename, bytes }` or `{ ok: false,
 * message }` — a bad upload is a normal outcome, not an exception.
 */
export async function saveProof(applicationId, file) {
  if (!file?.buffer?.length) return { ok: false, message: 'No file was received.' };

  const { maxBytes, maxMb } = proofLimits();
  if (file.size > maxBytes)
    return { ok: false, message: `That image is ${(file.size / 1048576).toFixed(1)}MB. The limit is ${maxMb}MB.` };

  if (file.mimetype && !ACCEPTED.has(file.mimetype))
    return { ok: false, message: 'Upload a JPEG, PNG or WebP screenshot.' };

  let image;
  try {
    image = sharp(file.buffer, { failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error('unreadable');
  } catch {
    return { ok: false, message: 'That file is not a readable image.' };
  }

  const filename = `${applicationId}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  const target = path.join(PROOF_DIR, filename);

  await image
    .rotate()                                          // apply EXIF orientation, then lose it
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true, mozjpeg: true })
    .toFile(target);

  const { size } = await fs.promises.stat(target);
  return { ok: true, filename, bytes: size };
}

/** Absolute path for serving, or null if the name is not one of ours. */
export function proofPath(filename) {
  if (!filename || !/^[\w-]+\.jpg$/.test(filename)) return null;
  const full = path.join(PROOF_DIR, filename);
  // Belt and braces against traversal even though the pattern above forbids it.
  if (!full.startsWith(PROOF_DIR)) return null;
  return fs.existsSync(full) ? full : null;
}

export async function deleteProof(filename) {
  const full = proofPath(filename);
  if (full) await fs.promises.unlink(full).catch(() => {});
}
