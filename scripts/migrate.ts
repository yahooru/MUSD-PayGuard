/**
 * Applies db/migrations/*.sql in order against DATABASE_URL (idempotent SQL).
 * Usage: npm run db:migrate   (reads .env.local if present)
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  try {
    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      process.stdout.write(`applying ${f} … `);
      await pool.query(sql);
      process.stdout.write("ok\n");
    }
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'payguard' ORDER BY table_name",
    );
    console.log(`payguard schema tables: ${rows.map((r: { table_name: string }) => r.table_name).join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
