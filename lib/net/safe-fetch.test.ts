import { test } from "node:test";
import assert from "node:assert/strict";

import { checkUrl, isBlockedAddress, sniffImageType, UnsafeUrlError } from "./safe-fetch.ts";

test("internal and reserved addresses are blocked", () => {
  for (const a of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::10.0.0.1",
  ]) {
    assert.equal(isBlockedAddress(a), true, a);
  }
});

test("public addresses are allowed", () => {
  for (const a of ["93.184.216.34", "8.8.8.8", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(a), false, a);
  }
});

test("unsafe URLs are refused before any network call", () => {
  for (const u of [
    "http://example.com/car.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1/car.jpg",
    "https://[::1]/car.jpg",
    "https://localhost/car.jpg",
    "https://metadata.google.internal/",
    "https://user:pass@example.com/car.jpg",
    "https://example.com:8443/car.jpg",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert.throws(() => checkUrl(u), UnsafeUrlError, u);
  }
  assert.equal(checkUrl("https://example.com/car.jpg").hostname, "example.com");
});

test("image type comes from the file's first bytes, not its name", () => {
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("RIFF0000WEBPVP8 ", "ascii")), "image/webp");
  assert.equal(sniffImageType(Buffer.from("<html>", "ascii")), null);
});
