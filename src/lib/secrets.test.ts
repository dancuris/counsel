import { describe, expect, it, beforeAll } from "vitest";
import { seal, unseal, hintOf } from "./secrets";

/**
 * The keys a user hands this app are the most sensitive thing it stores, and
 * the stand-alone security argument depends on them not sitting in plaintext.
 */
beforeAll(() => {
  process.env.SESSION_SECRET = "a-test-secret-of-reasonable-length-for-scrypt";
});

describe("seal and unseal", () => {
  it("round-trips a key", () => {
    const key = "sk-ant-api03-abcdefghijklmnop";
    expect(unseal(seal(key))).toBe(key);
  });

  it("produces different ciphertext each time", () => {
    // A fresh IV per seal, so two identical keys do not look identical at rest.
    expect(seal("same-value")).not.toBe(seal("same-value"));
  });

  it("refuses tampered ciphertext rather than returning garbage", () => {
    // GCM is authenticated: this is the property that makes a database write
    // by someone else detectable instead of silently honoured.
    const sealed = seal("sk-ant-real-key");
    const [iv, data, tag] = sealed.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(unseal([iv, flipped.toString("base64"), tag].join(":"))).toBeNull();
  });

  it("returns null under a different secret rather than throwing", () => {
    const sealed = seal("sk-ant-real-key");
    process.env.SESSION_SECRET = "a-completely-different-secret-value-here";
    expect(unseal(sealed)).toBeNull();
    process.env.SESSION_SECRET = "a-test-secret-of-reasonable-length-for-scrypt";
  });

  it("returns null for a malformed value", () => {
    expect(unseal("not-sealed")).toBeNull();
    expect(unseal("")).toBeNull();
  });
});

describe("hintOf", () => {
  it("shows only the last four characters", () => {
    // Never the first: provider keys carry a recognisable prefix, so a leading
    // fragment identifies the account where a trailing one only tells two keys
    // apart, which is all the UI needs.
    expect(hintOf("sk-ant-api03-abcdefwxyz")).toBe("...wxyz");
  });

  it("masks a value too short to hint at", () => {
    expect(hintOf("abc")).toBe("****");
  });
});
