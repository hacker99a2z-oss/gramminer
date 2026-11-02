import test from "node:test";
import assert from "node:assert/strict";
import { Address } from "@ton/core";
import {
  matchPayoutMessages,
  normalizeTonAddress,
  normalizeTonHash,
  transactionMatchesExternalHash,
} from "../lib/payout-utils.ts";

const address = Address.parse("0:" + "11".repeat(32));
const otherAddress = Address.parse("0:" + "22".repeat(32));
const bodyA = "aa".repeat(32);
const bodyB = "bb".repeat(32);

test("normalizes TON address formats to the same raw account", () => {
  assert.equal(normalizeTonAddress(address.toString()), address.toRawString().toLowerCase());
  assert.equal(normalizeTonAddress(address.toRawString()), address.toRawString().toLowerCase());
  assert.equal(normalizeTonAddress("not-an-address"), null);
});

test("normalizes transaction hashes and rejects malformed values", () => {
  assert.equal(normalizeTonHash("0x" + bodyA), bodyA);
  assert.equal(normalizeTonHash(Buffer.from(bodyA, "hex").toString("base64")), bodyA);
  assert.equal(normalizeTonHash("bad-hash"), null);
});

test("requires the exact wallet external-message hash", () => {
  assert.equal(transactionMatchesExternalHash({ in_msg: { hash: bodyA } }, bodyA), true);
  assert.equal(transactionMatchesExternalHash({ in_msg: { hash: bodyB } }, bodyA), false);
  assert.equal(transactionMatchesExternalHash({}, bodyA), false);
});

test("matches destination, exact nanotons and unique outgoing body hashes", () => {
  const expected = [
    { id: "w1", address: address.toRawString(), nano: "1000", bodyHash: bodyA },
    { id: "w2", address: otherAddress.toRawString(), nano: "2000", bodyHash: bodyB },
  ];
  const result = matchPayoutMessages(expected, [
    { destination: address.toString(), value: "1000", body_hash: bodyA },
    { destination: otherAddress.toRawString(), value: "2000", body_hash: bodyB },
  ]);
  assert.deepEqual(result, { matched: ["w1", "w2"], unmatched: [] });
});

test("does not match wrong amounts, recipients, body hashes or reused messages", () => {
  const expected = [
    { id: "w1", address: address.toRawString(), nano: "1000", bodyHash: bodyA },
    { id: "w2", address: address.toRawString(), nano: "1000", bodyHash: bodyA },
  ];
  const result = matchPayoutMessages(expected, [
    { destination: address.toRawString(), value: "999", body_hash: bodyA },
  ]);
  assert.deepEqual(result, { matched: [], unmatched: ["w1", "w2"] });
});
