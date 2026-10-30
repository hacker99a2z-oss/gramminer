import { closeDatabase, initializeDatabase } from "./lib/db.server.ts";

try {
  await initializeDatabase();
  console.log("Gram Miner database schema migration completed successfully.");
} catch (error) {
  console.error("Gram Miner database migration failed:", error);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
