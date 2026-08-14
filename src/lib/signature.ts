import { prisma } from "@/lib/prisma";
import { parseLabelled } from "@/lib/contact-block";
import type { SignatureOptions } from "@/lib/signature-format";

export type { SignatureOptions };
export { buildSignatureLines } from "@/lib/signature-format";

export async function getSignatureOptions(): Promise<SignatureOptions | null> {
  const p = await prisma.profile.findFirst({
    select: {
      contactName: true,
      contactPhone: true,
      contactLinks: true,
      contactEmails: true,
      contactAddresses: true,
      defaultEmailLabel: true,
      defaultAddressLabel: true,
    },
  });
  if (!p) return null;

  return {
    name: p.contactName ?? "",
    phone: p.contactPhone,
    links: p.contactLinks,
    emails: parseLabelled(p.contactEmails),
    addresses: parseLabelled(p.contactAddresses),
    defaultEmailLabel: p.defaultEmailLabel,
    defaultAddressLabel: p.defaultAddressLabel,
  };
}
