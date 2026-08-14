export type SignatureOptions = {
  name: string;
  phone: string | null;
  links: string | null;
  emails: { label: string; value: string }[];
  addresses: { label: string; value: string }[];
  defaultEmailLabel: string | null;
  defaultAddressLabel: string | null;
};

/**
 * Builds the sign-off block as plain lines.
 *
 * Kept apart from `signature.ts` because the composer is a client component and
 * that module imports Prisma: one import of a server module from the client
 * fails the whole build. The shape and the formatting are pure, so they live
 * here and the database read stays on the server.
 *
 * Deliberately does not emit "Best," and the name: the drafts already end that
 * way, and a second sign-off is worse than none. This is only what follows.
 */
export function buildSignatureLines(
  opts: SignatureOptions,
  choice: { emailLabel?: string | null; addressLabel?: string | null; includeLinks?: boolean }
): string[] {
  const email = opts.emails.find((e) => e.label === choice.emailLabel)?.value;
  const address = opts.addresses.find((a) => a.label === choice.addressLabel)?.value;

  return [email, opts.phone ?? undefined, address, choice.includeLinks ? opts.links ?? undefined : undefined]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
}
