import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Sealing and unsealing the credentials a user supplies.
 *
 * The stand-alone deployment model is the security argument for this app: one
 * customer, one database, so there is no query that could reach another
 * person's job search. That argument is worth nothing if their API keys sit in
 * plaintext in the row next to it. A database snapshot, a backup file or a
 * console session should not hand somebody a working key.
 *
 * AES-256-GCM, which is authenticated: tampering with the ciphertext fails the
 * tag check rather than silently decrypting to nonsense. The key is derived
 * from `SESSION_SECRET`, which already exists, is already required, and already
 * lives only in the environment.
 *
 * The consequence worth stating plainly: **rotating `SESSION_SECRET` makes
 * every stored credential unreadable.** That is the correct behaviour - it is
 * what makes the environment variable load-bearing rather than decorative - but
 * it means a rotation is a re-entry of keys, not a silent event. `unseal`
 * returns null rather than throwing so that case degrades into "no key
 * configured" instead of a crash.
 */

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set, so credentials cannot be encrypted.");
  // A fixed salt is acceptable here because the secret is already high-entropy
  // and per-deployment; the salt exists to derive 32 bytes, not to defend a
  // password against a dictionary.
  return scryptSync(secret, "counsel-credential-v1", 32);
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), encrypted.toString("base64"), tag.toString("base64")].join(":");
}

/** Returns null when the value cannot be read, rather than throwing. */
export function unseal(sealed: string): string | null {
  try {
    const [ivB64, dataB64, tagB64] = sealed.split(":");
    if (!ivB64 || !dataB64 || !tagB64) return null;
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or a value written before this format.
    return null;
  }
}

/**
 * The last four characters, for showing which key is configured.
 *
 * Never the whole value and never the first characters: provider keys carry a
 * recognisable prefix, so a leading fragment identifies the account while a
 * trailing one only distinguishes one key from another, which is all the UI
 * needs to answer "is the right one in here".
 */
export function hintOf(plaintext: string): string {
  const t = plaintext.trim();
  return t.length <= 4 ? "****" : `...${t.slice(-4)}`;
}
