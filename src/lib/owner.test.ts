import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rule that keeps a live instance from being taken over.
 *
 * `claimable` is the only thing standing between "a fresh deployment somebody
 * can set up from the web" and "a URL where the first stranger to find it owns
 * Dan's job search". It is worth testing directly rather than trusting by
 * reading, because the failure is silent and total.
 */

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { owner: { findUnique: () => findUnique() } } }));

const ENV = { ...process.env };

async function modes() {
  // Re-imported per test: the module reads environment variables at call time,
  // but a fresh import also clears anything cached inside it.
  vi.resetModules();
  const { signInModes } = await import("@/lib/owner");
  return signInModes();
}

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
  process.env = { ...ENV };
  delete process.env.ALLOWED_EMAIL;
  delete process.env.SETUP_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("signInModes.claimable", () => {
  it("is true on a fresh deployment with nothing configured", () => {
    return expect(modes()).resolves.toMatchObject({ claimable: true, password: false });
  });

  it("is FALSE when ALLOWED_EMAIL is set, even with no owner row", async () => {
    // Dan's live instance. It has never been claimed and must never be
    // claimable: the address in ALLOWED_EMAIL already owns it.
    process.env.ALLOWED_EMAIL = "owner@example.com";
    await expect(modes()).resolves.toMatchObject({ claimable: false });
  });

  it("is false once an owner exists", async () => {
    findUnique.mockResolvedValue({ id: "singleton", email: "a@b.com", passwordHash: "x" });
    await expect(modes()).resolves.toMatchObject({ claimable: false, password: true });
  });

  it("treats a missing table as unclaimed rather than throwing", async () => {
    // An un-migrated deployment must still render its login page.
    findUnique.mockRejectedValue(new Error("relation \"Owner\" does not exist"));
    await expect(modes()).resolves.toMatchObject({ claimable: true, password: false });
  });

  it("reports that a token is required when SETUP_TOKEN is set", async () => {
    process.env.SETUP_TOKEN = "abc";
    await expect(modes()).resolves.toMatchObject({ claimable: true, tokenRequired: true });
  });
});

describe("signInModes.google", () => {
  it("needs all three variables, not just the client pair", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    await expect(modes()).resolves.toMatchObject({ google: false });

    process.env.ALLOWED_EMAIL = "owner@example.com";
    await expect(modes()).resolves.toMatchObject({ google: true });
  });
});

describe("claimInstance", () => {
  async function claim(email: string, password: string, token = "", acknowledged = true) {
    vi.resetModules();
    const { claimInstance } = await import("@/lib/owner");
    return claimInstance(email, password, token, acknowledged);
  }

  it("refuses when the instance is locked to an email", async () => {
    process.env.ALLOWED_EMAIL = "owner@example.com";
    await expect(claim("someone@else.com", "a-long-enough-password")).resolves.toEqual({
      ok: false,
      error: "This instance already has an owner.",
    });
  });

  it("refuses a short password", async () => {
    await expect(claim("a@b.com", "short")).resolves.toMatchObject({ ok: false });
  });

  it("refuses something that is not an email", async () => {
    await expect(claim("not-an-email", "a-long-enough-password")).resolves.toMatchObject({ ok: false });
  });

  it("refuses without the license acknowledgment", async () => {
    // Checked in the library, not only in the form, so it cannot be posted around.
    await expect(claim("a@b.com", "a-long-enough-password", "", false)).resolves.toEqual({
      ok: false,
      error: "Please acknowledge the license terms to continue.",
    });
  });

  it("refuses a wrong setup token before touching the database", async () => {
    process.env.SETUP_TOKEN = "the-real-token";
    await expect(claim("a@b.com", "a-long-enough-password", "guess")).resolves.toEqual({
      ok: false,
      error: "That setup token is not right.",
    });
  });
});
