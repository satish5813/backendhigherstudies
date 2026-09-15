/**
 * Profile photos.
 *
 * Whatever a student uploads — a 6MB phone photo, a PNG with transparency, a
 * rotated JPEG carrying EXIF orientation — is normalised to a square 512px JPEG
 * before it touches disk. That keeps the resume PDF small, renders predictably
 * in print, and strips the location metadata phones bury in camera photos.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const AVATAR_DIR = path.resolve(here, '../../uploads/avatars');
export const MAX_AVATAR_BYTES = 6 * 1024 * 1024;
const SIZE = 512;

export const ACCEPTED_IMAGE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export async function ensureAvatarDir() {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
}

/**
 * @returns {Promise<{ok: true, url: string, filename: string, bytes: number} | {ok: false, error: string}>}
 */
export async function saveAvatar(buffer, userId) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return { ok: false, error: 'Image processing is unavailable on this server (sharp failed to load).' };
  }

  await ensureAvatarDir();

  try {
    const image = sharp(buffer, { failOn: 'none' });
    const meta = await image.metadata();

    if (!meta.width || !meta.height) {
      return { ok: false, error: 'That file is not a readable image.' };
    }
    if (meta.width < 150 || meta.height < 150) {
      return { ok: false, error: `That image is only ${meta.width}x${meta.height}. Use one at least 150x150 or it will look blurry on your resume.` };
    }

    // A fresh name each time, so a replaced photo never serves from cache.
    const filename = `${userId}-${crypto.randomBytes(8).toString('hex')}.jpg`;
    const target = path.join(AVATAR_DIR, filename);

    await image
      .rotate()                                   // honour EXIF orientation, then drop it
      .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toFile(target);

    const { size } = await fs.stat(target);
    return { ok: true, url: `/uploads/avatars/${filename}`, filename, bytes: size };
  } catch (err) {
    return { ok: false, error: `Could not process that image: ${err.message}` };
  }
}

/** Removes a previously stored avatar. Never throws — a missing file is fine. */
export async function deleteAvatar(url) {
  if (!url || !url.startsWith('/uploads/avatars/')) return;
  const filename = path.basename(url);
  // basename() already strips traversal, but be explicit about the boundary.
  const target = path.join(AVATAR_DIR, filename);
  if (!target.startsWith(AVATAR_DIR)) return;
  await fs.unlink(target).catch(() => {});
}
