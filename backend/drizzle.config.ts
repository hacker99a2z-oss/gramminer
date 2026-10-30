import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./backend/drizzle/schema.ts",
  out: "./backend/drizzle/migrations",
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL ?? "",
  },
});
