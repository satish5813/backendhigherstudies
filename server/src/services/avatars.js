/**
 * Profile photos.
 *
 * Whatever a student uploads — a 6MB phone photo, a PNG with transparency, a
 * rotated JPEG carrying EXIF orientation — is normalised to a square 512px JPEG
 * before it is stored. That keeps the resume PDF small, renders predictably in
 * print, and strips the location metadata phones bury in camera photos.
 *
 * Stored in the database (see services/fileStore.js), not on disk: the disk
 * did not survive a redeploy, and neither did anyone's photo. Files written
 * before that change are still read from disk if they happen to be there.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deleteFile, getFile, putFile } from './fileStore.js';

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

const SAFE_NAME = /^[\w-]+\.jpg$/;

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

    const bytes = await image
      .rotate()                                   // honour EXIF orientation, then drop it
      .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();

    await putFile({ name: filename, kind: 'avatar', ownerId: userId, mime: 'image/jpeg', bytes });
    return { ok: true, url: `/uploads/avatars/${filename}`, filename, bytes: bytes.length };
  } catch (err) {
    return { ok: false, error: `Could not process that image: ${err.message}` };
  }
}

/**
 * The stored photo for a URL's file name, or null.
 * Database first; then the disk, for anything uploaded before the change.
 * @returns {Promise<{mime: string, bytes: Buffer} | null>}
 */
export async function readAvatar(filename) {
  if (!SAFE_NAME.test(filename || '')) return null;
  const stored = await getFile(filename);
  if (stored) return { mime: stored.mime, bytes: stored.bytes };
  const target = path.join(AVATAR_DIR, filename);
  if (!target.startsWith(AVATAR_DIR)) return null;
  try {
    return { mime: 'image/jpeg', bytes: await fs.readFile(target) };
  } catch {
    return null;
  }
}

/** True if the photo exists on disk (legacy files only; the database is checked separately). */
export async function avatarOnDisk(filename) {
  if (!SAFE_NAME.test(filename || '')) return false;
  try { await fs.access(path.join(AVATAR_DIR, filename)); return true; } catch { return false; }
}

/** Removes a previously stored avatar. Never throws — a missing file is fine. */
export async function deleteAvatar(url) {
  if (!url || !url.startsWith('/uploads/avatars/')) return;
  const filename = path.basename(url);
  await deleteFile(filename).catch(() => {});
  // basename() already strips traversal, but be explicit about the boundary.
  const target = path.join(AVATAR_DIR, filename);
  if (!target.startsWith(AVATAR_DIR)) return;
  await fs.unlink(target).catch(() => {});
}
