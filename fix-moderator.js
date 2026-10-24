import pg from "pg";
import bcrypt from "bcrypt";
import env from "dotenv";
env.config();

// Online (Neon): set DATABASE_URL. Locally: the old settings below still work.
const db = new pg.Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : true,
        max: 10,
        idleTimeoutMillis: 20000, // drop idle connections before Neon suspends them
        connectionTimeoutMillis: 15000, // allow time for Neon to wake up
      }
    : {
        user: "postgres",
        host: "localhost",
        database: "ta3lam",
        password: process.env.DATA_PASS,
        port: 5432,
      }
);

const email = (process.env.MODERATOR_EMAIL || "").trim().toLowerCase();
const pass = process.env.MODERATOR_PASSWORD || "";
if (!email || pass.length < 8) {
  console.log("Set MODERATOR_EMAIL and MODERATOR_PASSWORD (8+ chars) in .env first");
  process.exit(1);
}

try {
  const hash = await bcrypt.hash(pass, 10);
  const mods = await db.query("SELECT id FROM users WHERE role = 'moderator'");
  const taken = await db.query("SELECT id, role FROM users WHERE email = $1", [email]);

  if (mods.rowCount) {
    const m = mods.rows[0];
    if (taken.rowCount && taken.rows[0].id !== m.id) {
      console.log(`${email} belongs to another account (${taken.rows[0].role}). Use a different MODERATOR_EMAIL.`);
    } else {
      await db.query("UPDATE users SET email = $1, password = $2 WHERE id = $3", [email, hash, m.id]);
      console.log(`Moderator updated. Log in with: ${email}`);
    }
  } else if (taken.rowCount) {
    console.log(`${email} belongs to another account (${taken.rows[0].role}). Use a different MODERATOR_EMAIL.`);
  } else {
    await db.query("INSERT INTO users (email, password, role) VALUES ($1, $2, 'moderator')", [email, hash]);
    console.log(`Moderator created. Log in with: ${email}`);
  }
} catch (e) {
  console.error("Failed:", e.message);
}
await db.end();