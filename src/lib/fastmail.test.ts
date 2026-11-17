import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Fastmail client, with the network and the database replaced.
 *
 * The rule worth pinning is the Bcc one: a hidden address must reach the
 * envelope and must never appear in the message itself, because getting that
 * wrong exposes somebody who was meant to be invisible. The rest covers the
 * id prefix that routes replies back to the right mailbox, and body
 * extraction, where an HTML-only message must not arrive as raw markup.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fastmailConnection: {
      findUnique: vi.fn(async () => ({ id: "singleton", email: "me@example.com", sealedToken: "sealed", hint: "abcd", canSend: true })),
    },
  },
}));
vi.mock("@/lib/secrets", () => ({ seal: (v: string) => v, unseal: () => "fmu1-test", hintOf: (v: string) => v.slice(-4) }));
vi.mock("@/lib/demo", () => ({ refuseInDemo: () => {} }));

import { bodyOf, isFastmailId, sendFastmail } from "./fastmail";

afterEach(() => vi.unstubAllGlobals());

describe("isFastmailId", () => {
  it("tells a Fastmail id from a Gmail one", () => {
    expect(isFastmailId("fastmail:M123")).toBe(true);
    expect(isFastmailId("18c2f0a9b1d2e3f4")).toBe(false);
    expect(isFastmailId(null)).toBe(false);
  });
});

describe("bodyOf", () => {
  it("joins the text parts", () => {
    expect(
      bodyOf({ textBody: [{ partId: "1", type: "text/plain" }], bodyValues: { "1": { value: "Hello there" } } })
    ).toBe("Hello there");
  });

  it("strips an HTML part standing in for plain text", () => {
    const out = bodyOf({
      textBody: [{ partId: "2", type: "text/html" }],
      bodyValues: { "2": { value: "<p>Thanks &amp; regards</p><style>p{}</style>" } },
    });
    expect(out).toBe("Thanks & regards");
  });

  it("survives a malformed shape rather than walking a string", () => {
    expect(bodyOf({ textBody: "nope" as unknown as [], bodyValues: undefined })).toBe("");
  });
});

describe("sendFastmail", () => {
  it("puts Bcc in the envelope and never in the message", async () => {
    let uploaded = "";
    let submission: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (url.endsWith("/jmap/session")) {
          return json({
            apiUrl: "https://api.example/jmap/api/",
            uploadUrl: "https://api.example/upload/{accountId}/",
            username: "me@example.com",
            primaryAccounts: { "urn:ietf:params:jmap:mail": "A1", "urn:ietf:params:jmap:submission": "A1" },
          });
        }
        if (url.startsWith("https://api.example/upload/")) {
          uploaded = Buffer.from(init!.body as Buffer).toString("utf8");
          return json({ blobId: "B1" });
        }
        const req = JSON.parse(String(init!.body)) as { methodCalls: [string, Record<string, unknown>, string][] };
        const [name, args, tag] = req.methodCalls[0];
        if (name === "Mailbox/get") {
          return json({ methodResponses: [[name, { list: [{ id: "d", role: "drafts" }, { id: "s", role: "sent" }, { id: "i", role: "inbox" }] }, tag]] });
        }
        if (name === "Identity/get") {
          return json({ methodResponses: [[name, { list: [{ id: "I1", email: "me@example.com", name: "Me" }] }, tag]] });
        }
        if (name === "Email/import") {
          submission = req.methodCalls[1][1];
          return json({
            methodResponses: [
              ["Email/import", { created: { m: { id: "E1", threadId: "T1" } } }, "imp"],
              ["EmailSubmission/set", { created: { s: { id: "S1" } } }, "sub"],
            ],
          });
        }
        void args;
        return json({ methodResponses: [] });
      })
    );

    const sent = await sendFastmail({
      to: "recruiter@northwind.example",
      cc: "copy@northwind.example",
      bcc: "hidden@elsewhere.example",
      subject: "Hello",
      body: "Body text",
    });

    expect(sent).toEqual({ id: "fastmail:E1", threadId: "fastmail:T1" });
    expect(uploaded).not.toMatch(/^Bcc:/im);
    expect(uploaded).not.toContain("hidden@elsewhere.example");
    expect(uploaded).toMatch(/^Message-ID: </m);
    expect(uploaded).toMatch(/^From: "Me" <me@example\.com>/m);

    const create = (submission as unknown as { create: { s: { envelope: { rcptTo: { email: string }[] } } } }).create;
    expect(create.s.envelope.rcptTo.map((r) => r.email).sort()).toEqual(
      ["copy@northwind.example", "hidden@elsewhere.example", "recruiter@northwind.example"].sort()
    );
  });
});
