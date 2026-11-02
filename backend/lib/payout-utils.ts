import { Address } from "@ton/core";

export type TonOutboundMessage = {
  destination?: string;
  value?: string;
  body_hash?: string;
};

export type TonTransaction = {
  utime?: number;
  transaction_id?: { hash?: string };
  in_msg?: { hash?: string | null } | null;
  out_msgs?: TonOutboundMessage[] | null;
};

/** TON message/transaction hashes may be returned as hex or base64. */
export function normalizeTonHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^0x/i, "");
  if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();

  try {
    const decoded = Buffer.from(normalized.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (decoded.length === 32) return decoded.toString("hex");
  } catch {
    // Invalid data is deliberately treated as a non-match.
  }
  return null;
}

export function normalizeTonAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return Address.parse(value).toRawString().toLowerCase();
  } catch {
    return null;
  }
}

/** Match the wallet transaction's inbound external message against the exact signed BOC hash. */
export function transactionMatchesExternalHash(
  transaction: TonTransaction,
  externalMessageHash: string,
): boolean {
  const expected = normalizeTonHash(externalMessageHash);
  const actual = normalizeTonHash(transaction.in_msg?.hash);
  return expected !== null && actual === expected;
}

/** Match each withdrawal to a distinct outgoing TON message with exact recipient, value and body. */
export function matchPayoutMessages(
  expected: Array<{ id: string; address: string; nano: string; bodyHash: string }>,
  outgoing: TonOutboundMessage[],
): { matched: string[]; unmatched: string[] } {
  const used = new Set<number>();
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const payout of expected) {
    const destination = normalizeTonAddress(payout.address);
    const bodyHash = normalizeTonHash(payout.bodyHash);
    const index = outgoing.findIndex((message, candidateIndex) => {
      if (used.has(candidateIndex)) return false;
      return destination !== null &&
        normalizeTonAddress(message.destination) === destination &&
        String(message.value ?? "") === payout.nano &&
        bodyHash !== null &&
        normalizeTonHash(message.body_hash) === bodyHash;
    });

    if (index < 0) unmatched.push(payout.id);
    else {
      used.add(index);
      matched.push(payout.id);
    }
  }

  return { matched, unmatched };
}
