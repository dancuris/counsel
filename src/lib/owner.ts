import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { LICENSE_VERSION } from "@/lib/license";

/**
 * Who owns this deployment, and the three ways in.
 *
 * Sign-in was Google OAuth locked to `ALLOWED_EMAIL`, and that single choice is
 * what made the app impossible to hand to anybody. Before a new person could
 * see one screen they had to create a Google Cloud project, configure a consent
 * screen and register a redirect URI for their own deployment - about fifteen
 * minutes of console work, in front of the value rather than behind it, and
 * nothing a deploy button can do on their behalf.
 *
 * Demo mode had already proved the app can authenticate with a password. This
 * makes that a first-class path rather than a demo-only escape hatch, which
 * demotes Google from "how you sign in" to "an optional mail integration",
 * which is what it always should have been.
 *
 * ## What stops a stranger claiming an instance
 *
 * An unclaimed deployment is a URL where the first visitor becomes the owner.
 * That is the standard self-hosted first-run pattern and it carries a real
 * race: between deploying and claiming, whoever loads the page first wins.
 * Three things narrow it, and the honest answer is that the window exists.
 *
 * 1. **`ALLOWED_EMAIL` closes it completely.** An instance with that variable
 *    set is already owned by whoever that address belongs to, so `claimable()`
 *    is false forever. Dan's live deployment has it set. It cannot be claimed
 *    by anybody who finds the URL, and its Google sign-in is untouched.
 * 2. **`SETUP_TOKEN` closes it for anybody who wants that.** Set it and the
 *    claim needs the token as well, so the URL alone is not enough.
 * 3. **Claiming is once.** After it succeeds there is no second claim and no
 *    reset from the web: the row has to be deleted from the database.
 */

/** Cost 12: about a quarter-second per attempt, which is the rate limiter. */
const BCRYPT_COST = 12;

// Re-exported so server callers can keep importing it from here, while the
// sign-in form reads it from a module that does not pull bcrypt into the
// browser bundle.
export { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

export type SignInModes = {
  /** A password has been set, so the password form should show. */
  password: boolean;
  /** Google OAuth is configured on this deployment. */
  google: boolean;
  /** Nobody owns this yet and the claim form should show. */
  claimable: boolean;
  /** A claim additionally needs SETUP_TOKEN. */
  tokenRequired: boolean;
};

function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.ALLOWED_EMAIL?.trim()
  );
}

async function ownerRow() {
  try {
    return await prisma.owner.findUnique({ where: { id: TENANT_ID } });
  } catch {
    // An un-migrated deployment has no table yet. That is "nobody has claimed
    // this", not an error, and it must not take the login page down.
    return null;
  }
}

export async function signInModes(): Promise<SignInModes> {
  const owner = await ownerRow();
  const lockedToAnEmail = Boolean(process.env.ALLOWED_EMAIL?.trim());
  return {
    password: Boolean(owner),
    google: googleConfigured(),
    // The second condition is the one protecting the live instance.
    claimable: !owner && !lockedToAnEmail,
    tokenRequired: Boolean(process.env.SETUP_TOKEN?.trim()),
  };
}

export type ClaimResult = { ok: true } | { ok: false; error: string };

/**
 * Takes ownership of an unclaimed instance.
 *
 * Every refusal is checked here rather than in the route, so a second caller
 * cannot skip one. The claimable test is re-read inside this function on
 * purpose: the page that rendered the form may be seconds stale.
 */
export async function claimInstance(
  email: string,
  password: string,
  token: string,
  acknowledged: boolean
): Promise<ClaimResult> {
  const modes = await signInModes();
  if (!modes.claimable) {
    return { ok: false, error: "This instance already has an owner." };
  }

  if (modes.tokenRequired) {
    const expected = process.env.SETUP_TOKEN?.trim() ?? "";
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return { ok: false, error: "That setup token is not right." };
    }
  }

  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return { ok: false, error: "That does not look like an email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // Checked here rather than only in the form, so the acknowledgment is a
  // condition of ownership rather than a box that can be posted around.
  if (!acknowledged) {
    return { ok: false, error: "Please acknowledge the license terms to continue." };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    // `create`, never `upsert`. An upsert would quietly overwrite an existing
    // owner, which is the one thing this function must never do.
    await prisma.owner.create({
      data: {
        id: TENANT_ID,
        email: address,
        passwordHash,
        acknowledgedAt: new Date(),
        acknowledgedVersion: LICENSE_VERSION,
      },
    });
  } catch {
    // Unique violation: somebody claimed it between the check and the write.
    return { ok: false, error: "This instance already has an owner." };
  }
  return { ok: true };
}

/**
 * Whether these credentials open this instance.
 *
 * Always runs a bcrypt comparison, even when there is no owner and even when
 * the address does not match, so a wrong email and a wrong password take the
 * same time. Otherwise the response time tells an attacker which half was
 * right, and the email is the easier half to guess.
 */
export async function verifyOwnerPassword(email: string, password: string): Promise<boolean> {
  const owner = await ownerRow();
  const hash = owner?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash);
  if (!owner) return false;
  return matches && owner.email === email.trim().toLowerCase();
}

/**
 * A real bcrypt hash of a value nobody knows, compared against when no owner
 * exists so the timing of that path matches a genuine failure.
 */
const DUMMY_HASH = "$2b$12$AOO6RFCvLFp0hjmNg70QfelIs0knSXiH/.wkXtWZSpSF2SsRLCIJ2";

export async function ownerEmail(): Promise<string | null> {
  return (await ownerRow())?.email ?? null;
}

/** Changes the password for an instance that already has an owner. */
export async function changeOwnerPassword(current: string, next: string): Promise<ClaimResult> {
  const owner = await ownerRow();
  if (!owner) return { ok: false, error: "This instance has no password to change." };
  if (!(await bcrypt.compare(current, owner.passwordHash))) {
    return { ok: false, error: "That is not the current password." };
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  await prisma.owner.update({
    where: { id: TENANT_ID },
    data: { passwordHash: await bcrypt.hash(next, BCRYPT_COST) },
  });
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
