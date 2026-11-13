/** Server environment access with explicit, early failures. Never import from client components. */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  sessionSecret: () => {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  cronSecret: () => required("CRON_SECRET"),
  isProduction: () => process.env.NODE_ENV === "production",
};
