import assert from "node:assert/strict";
import test from "node:test";

process.env["TURSO_DATABASE_URL"] = "file::memory:";
delete process.env["TURSO_AUTH_TOKEN"];

const { getDb, initializeDatabase, closeDatabase } = await import("../lib/db.server.ts");
await initializeDatabase();
const db = getDb();

test("migrations are idempotent and schema version 3 is present", async () => {
  await initializeDatabase();
  const result = await db.execute("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(result.rows.map((row) => Number(row["version"])), [1, 2, 3]);
});

test("balance guards reject negative player balances", async () => {
  await db.execute({
    sql: "INSERT INTO players(tg_id, first_name, created_at) VALUES (?, ?, ?)",
    args: [1001, "Test Miner", new Date().toISOString()],
  });
  await assert.rejects(
    db.execute({ sql: "UPDATE players SET coins = -1 WHERE tg_id = ?", args: [1001] }),
    /cannot be negative/i,
  );
  await assert.rejects(
    db.execute({ sql: "UPDATE players SET balance_milli = -1 WHERE tg_id = ?", args: [1001] }),
    /cannot be negative/i,
  );
});

test("miner and withdrawal constraints protect valid IDs, owners and statuses", async () => {
  await assert.rejects(
    db.execute({ sql: "INSERT INTO miners(tg_id, miner_id, started_at) VALUES (?, ?, ?)", args: [1001, 6, new Date().toISOString()] }),
    /invalid miner id/i,
  );
  await assert.rejects(
    db.execute({ sql: "INSERT INTO miners(tg_id, miner_id, started_at) VALUES (?, ?, ?)", args: [9999, 1, new Date().toISOString()] }),
    /owner does not exist/i,
  );
  await db.execute({ sql: "INSERT INTO miners(tg_id, miner_id, started_at) VALUES (?, ?, ?)", args: [1001, 1, new Date().toISOString()] });
  await assert.rejects(
    db.execute({
      sql: "INSERT INTO withdrawals(id, tg_id, amount_milli, nano, address, status, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: ["invalid-status", 1001, 30, "100", "0:" + "1".repeat(64), "unknown", "invalid-key", new Date().toISOString()],
    }),
    /invalid withdrawal status/i,
  );
});

test("withdrawal idempotency key is unique per Telegram user", async () => {
  const values = ["withdrawal-one", 1001, 30, "100", "0:" + "1".repeat(64), "retry-key-00000001", new Date().toISOString()];
  await db.execute({
    sql: "INSERT INTO withdrawals(id, tg_id, amount_milli, nano, address, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: values,
  });
  await assert.rejects(
    db.execute({
      sql: "INSERT INTO withdrawals(id, tg_id, amount_milli, nano, address, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["withdrawal-two", ...values.slice(1)],
    }),
    /unique/i,
  );
});

test("balance ledger requires an existing player and rejects zero deltas", async () => {
  await assert.rejects(
    db.execute({
      sql: "INSERT INTO balance_ledger(id, tg_id, asset, entry_type, delta, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["orphan", 9999, "coins", "test", 1, 1, new Date().toISOString()],
    }),
    /ledger owner does not exist/i,
  );
  await assert.rejects(
    db.execute({
      sql: "INSERT INTO balance_ledger(id, tg_id, asset, entry_type, delta, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["zero", 1001, "coins", "test", 0, 0, new Date().toISOString()],
    }),
    /CHECK constraint failed/i,
  );
});


test("payout lease is exclusive and a stale owner cannot release another owner's lock", async () => {
  const now = new Date().toISOString();
  await db.execute({
    sql: "INSERT OR REPLACE INTO locks(id, until, owner_token) VALUES ('payout', ?, NULL)",
    args: [new Date(0).toISOString()],
  });

  const first = await db.execute({
    sql: "UPDATE locks SET until = ?, owner_token = ? WHERE id = 'payout' AND until < ?",
    args: [new Date(Date.now() + 120_000).toISOString(), "worker-a", now],
  });
  assert.equal(first.rowsAffected, 1);

  const contender = await db.execute({
    sql: "UPDATE locks SET until = ?, owner_token = ? WHERE id = 'payout' AND until < ?",
    args: [new Date(Date.now() + 120_000).toISOString(), "worker-b", new Date().toISOString()],
  });
  assert.equal(contender.rowsAffected, 0);

  const staleRelease = await db.execute({
    sql: "UPDATE locks SET until = ?, owner_token = NULL WHERE id = 'payout' AND owner_token = ?",
    args: [new Date(0).toISOString(), "worker-b"],
  });
  assert.equal(staleRelease.rowsAffected, 0);

  const stillOwned = await db.execute("SELECT owner_token FROM locks WHERE id = 'payout'");
  assert.equal(String(stillOwned.rows[0]?.["owner_token"]), "worker-a");

  const ownerRelease = await db.execute({
    sql: "UPDATE locks SET until = ?, owner_token = NULL WHERE id = 'payout' AND owner_token = ?",
    args: [new Date(0).toISOString(), "worker-a"],
  });
  assert.equal(ownerRelease.rowsAffected, 1);
});

test("database closes cleanly", () => {
  closeDatabase();
});
