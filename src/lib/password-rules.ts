/**
 * The password rule, in a module with no server dependencies.
 *
 * It lived in `owner.ts` beside the functions that use it, which reads well and
 * does not build: `owner.ts` imports bcrypt and Prisma, so a client component
 * importing one constant from it drags `node:module` into the browser bundle.
 * Turbopack fails the build with "the chunking context does not support
 * external modules", naming the component rather than the import.
 *
 * The form needs the number for its `minLength` and its placeholder, and the
 * server needs it to enforce. Both read it here, so the rule the field advertises
 * and the rule that refuses cannot drift.
 */

/**
 * Twelve rather than eight. One guess opens the entire instance, and there is
 * no second factor and no lockout: bcrypt's cost is the only rate limiter.
 */
export const MIN_PASSWORD_LENGTH = 12;
