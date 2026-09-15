import { execute, query, queryOne } from '../config/db.js';

/**
 * Uploaded files, kept in the database.
 *
 * The container's disk is ephemeral: a redeploy replaces it, and with it every
 * profile photo and every application-proof screenshot a student had uploaded.
 * That happened. Persistent volumes would fix it too, but they are a piece of
 * hosting configuration that has to be remembered on every server this ever
 * runs on; a table cannot be forgotten, and it is inside the backups.
 *
 * The files are small by construction — sharp normalises a photo to a 512px
 * JPEG and caps a proof at 1600px — so LONGBLOB rows are entirely reasonable
 * at this scale (hundreds of students, not millions).
 */

export async function putFile({ name, kind, ownerId = null, mime = 'image/jpeg', bytes }) {
  await execute(
    `INSERT INTO stored_files (name, kind, owner_id, mime, size, bytes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE kind = VALUES(kind), owner_id = VALUES(owner_id),
       mime = VALUES(mime), size = VALUES(size), bytes = VALUES(bytes)`,
    [name, kind, ownerId, mime, bytes.length, bytes]
  );
  return { name, size: bytes.length };
}

/** @returns {Promise<{name, kind, mime, size, bytes: Buffer} | null>} */
export async function getFile(name) {
  if (!name) return null;
  return queryOne(`SELECT name, kind, owner_id, mime, size, bytes FROM stored_files WHERE name = ?`, [name]);
}

export async function hasFile(name) {
  if (!name) return false;
  const row = await queryOne(`SELECT 1 AS ok FROM stored_files WHERE name = ?`, [name]);
  return Boolean(row);
}

export async function deleteFile(name) {
  if (!name) return;
  await execute(`DELETE FROM stored_files WHERE name = ?`, [name]);
}

/**
 * Clear references to files that exist nowhere any more.
 *
 * Run once at boot. Until uploads moved into the database, a redeploy wiped
 * the files but left `users.avatar_url` and `job_applications.proof_file`
 * pointing at them — so a profile showed a broken image and an officer saw a
 * proof link that opened nothing. A cleared reference shows initials and
 * "no proof yet", both of which invite the student to upload again.
 *
 * `exists(name)` lets the caller also accept files still on disk from before
 * the change, so a local development machine keeps its photos.
 */
export async function reconcileReferences({ exists = async () => false } = {}) {
  let cleared = 0;

  const avatars = await query(`SELECT id, avatar_url FROM users WHERE avatar_url LIKE '/uploads/avatars/%'`);
  for (const u of avatars) {
    const name = u.avatar_url.split('/').pop();
    if (await hasFile(name)) continue;
    if (await exists('avatar', name)) continue;
    await execute(`UPDATE users SET avatar_url = NULL WHERE id = ?`, [u.id]);
    cleared++;
  }

  const proofs = await query(`SELECT id, proof_file FROM job_applications WHERE proof_file IS NOT NULL`);
  for (const a of proofs) {
    if (await hasFile(a.proof_file)) continue;
    if (await exists('proof', a.proof_file)) continue;
    await execute(`UPDATE job_applications SET proof_file = NULL, proof_bytes = NULL, proof_at = NULL WHERE id = ?`, [a.id]);
    cleared++;
  }

  return cleared;
}
