import express from "express";
import multer from "multer";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import env from "dotenv";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

env.config(); // FIX: must run before process.env is used

const app = express();
const port = Number(process.env.PORT) || 5000;
const saltRounds = 10;

// Return DATE columns as plain 'YYYY-MM-DD' strings (avoids timezone shifts)
pg.types.setTypeParser(1082, (v) => v);

app.set("view engine", "ejs");
app.use(express.static("public")); // FIX: serves /css, /uploads, scripts, images
app.use(bodyParser.urlencoded({ extended: true }));

// Teacher photos: kept in memory first so we can check the real file type before saving anything.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 MB
}).single("photo");

// Detect the image type from the file's first bytes (the browser's mimetype/extension can be faked)
function imageType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}
const removePhoto = (name) => {
  if (name) db.query("DELETE FROM teacher_photos WHERE name = $1", [path.basename(name)]).catch(() => {});
};

// Online (Neon): set DATABASE_URL. Locally: the old settings below still work.
const db = new pg.Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : true,
        max: 5,
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
// an idle connection dropping must not crash the whole site
db.on("error", (e) => console.error("Database pool error:", e.message));

db.query("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS photo TEXT").catch((e) =>
  console.error("Could not add teachers.photo column:", e.message)
);

// Teacher photos live in the database (Vercel's filesystem is read-only and not persistent)
db.query(
  "CREATE TABLE IF NOT EXISTS teacher_photos (name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL)"
).catch((e) => console.error("Could not create teacher_photos table:", e.message));

app.get("/uploads/teachers/:name", async (req, res) => {
  try {
    const r = await db.query("SELECT mime, data FROM teacher_photos WHERE name = $1", [path.basename(req.params.name)]);
    if (!r.rowCount) return res.status(404).end();
    res.set("Content-Type", r.rows[0].mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(r.rows[0].data);
  } catch (e) {
    console.error("Photo load failed:", e.message);
    res.status(500).end();
  }
});

const isProd = process.env.NODE_ENV === "production";
if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is missing (set it in .env locally or in Vercel > Settings > Environment Variables)");
if (isProd) app.set("trust proxy", 1);

// CSP is off because your pages use inline scripts, Google Fonts and external images
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: "same-origin" } }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ pool: db, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
    },
  })
);

// CSRF defence: reject cross-site form posts (works with SameSite=Lax, no view changes needed)
// CSRF defence: reject cross-site form posts (works with SameSite=Lax, no view changes needed)
const allowedHosts = (process.env.ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();

  // Browsers say whether the request came from our own site
  const site = req.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return next();

  // Older browsers / plain-http addresses: fall back to comparing Origin with Host
  if (!site) {
    const origin = req.get("origin");
    if (!origin) return next();
    const host = req.get("x-forwarded-host") || req.get("host");
    try {
      const o = new URL(origin).host;
      if (o === host || allowedHosts.includes(o)) return next();
    } catch (e) {}
  }

  console.warn(`Blocked POST: sec-fetch-site=${site} origin=${req.get("origin")} host=${req.get("host")}`);
  res.status(403).send("Bad origin");
});
app.use(passport.initialize());
app.use(passport.session());


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", saltRounds);

const authErrors = {
  bad: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  limit: "محاولات كثيرة، حاول مرة أخرى بعد 15 دقيقة.",
};
const limiter = (to) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    
    handler: (req, res) => res.redirect(`${to}?error=limit`),
  });


/* ---------- helpers for the EJS views ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (t) => {
  const h = parseInt(t.slice(0, 2), 10);
  return `${pad(h % 12 || 12)}:${t.slice(3, 5)} ${h >= 12 ? "م" : "ص"}`;
};
const fmtDate = (s) =>
  new Date(`${s}T00:00:00`).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
const fmtMonth = (d) => new Date(d).toLocaleDateString("ar", { month: "long", year: "numeric" });
// Vercel servers run in UTC, so "now" is computed in the site's own timezone (set APP_TIMEZONE to change it)
const APP_TZ = process.env.APP_TIMEZONE || "Africa/Cairo";
const wallNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: APP_TZ }));
const isUpcoming = (r) => new Date(`${r.slot_date}T${r.start_time}`) >= wallNow();

// "now" in the server's local time, so it matches how teachers' times are entered
const nowLocal = () => {
  const d = wallNow();
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// turns slot_datetime + duration_minutes into the date / start / end fields the pages use
const SLOT_COLS = `a.slot_datetime::date AS slot_date,
  a.slot_datetime::time AS start_time,
  (a.slot_datetime + make_interval(mins => COALESCE(a.duration_minutes, 60)))::time AS end_time`;

// Makes Arabic search forgiving: ignores tashkeel/tatweel, and treats أ إ آ as ا, ة as ه, ى as ي
const NORM = (x) =>
  `translate(regexp_replace(lower(${x}::text), '[\u064B-\u0652\u0640]', '', 'g'), 'أإآةىؤئ', 'اااهيوي')`;
// escape % _ \ so the user's text is matched literally inside LIKE
const likeOf = (v) => `%${v.replace(/[\\%_]/g, "\\$&")}%`;

/* ---------- middleware ---------- */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === "moderator") {
    return next();
  }
  res.status(403).send("Access denied");
}

const requireRole = (role) => (req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  if (req.user.role !== role) return res.redirect("/dashboard");
  next();
};

app.use((req, res, next) => {
  res.locals.isAuthenticated = req.isAuthenticated();
  res.locals.user = req.user || null;
  res.locals.error = req.query.error || null;
  res.locals.notice = req.query.notice || null;
  Object.assign(res.locals, { fmtTime, fmtDate, fmtMonth });
  next();
});

/* ---------- public pages ---------- */
app.get("/", (req, res) => res.render("index.ejs"));



app.get("/dashboard", ensureAuthenticated, (req, res) => {
  const home = { teacher: "/teacher", moderator: "/admin" }[req.user.role] || "/profile";
  res.redirect(home);
});

/* ---------- auth ---------- */

app.get("/register", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/dashboard");
  if (req.query.tab === "login") return res.redirect("/login");
  res.render("register.ejs", { tab: "register", error: authErrors[req.query.error] || null });
});

app.get("/login", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/dashboard");
  res.render("register.ejs", { tab: "login", error: authErrors[req.query.error] || null });
});

app.post(
  "/login",
  limiter("/login"),
  passport.authenticate("local", {
    successRedirect: "/dashboard",
    failureRedirect: "/login?error=bad",
  })
);

app.post("/register", limiter("/register"), async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const f_name = str(req.body.f_name);
  const l_name = str(req.body.l_name);
  const phone_number = str(req.body.phone_number);

  const fail = (msg) => res.render("register.ejs", { tab: "register", error: msg });

  if (!EMAIL_RE.test(email) || email.length > 254) return fail("البريد الإلكتروني غير صالح.");
  if (password.length < 8) return fail("كلمة المرور يجب ألا تقل عن 8 أحرف.");
  if (Buffer.byteLength(password) > 72) return fail("كلمة المرور طويلة جداً.");
  if (!/^[0-9+\s-]{7,20}$/.test(phone_number)) return fail("رقم الجوال غير صالح.");
  if (!f_name || !l_name) return fail("الرجاء إدخال الاسم الأول واسم العائلة.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await client.query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, 'student') RETURNING id, email, role, created_at",
      [email, hash]
    );
    const u = rows[0];
    await client.query(
      "INSERT INTO students (user_id, f_name, l_name, phone_number) VALUES ($1, $2, $3, $4)",
      [u.id, f_name, l_name, phone_number]
    );
    await client.query("COMMIT");
    req.login(u, (err) => (err ? res.redirect("/login") : res.redirect("/dashboard")));
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return fail("هذا البريد الإلكتروني مسجل مسبقاً.");
    console.error(err);
    fail("حدث خطأ غير متوقع، حاول مرة أخرى.");
  } finally {
    if (client) client.release();
  }
});

app.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});




/* ---------- forgot / reset password ---------- */
const RESET_MINUTES = 30;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const TOKEN_RE = /^[a-f0-9]{64}$/;
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// the table is created on start; its user_id column copies the type of users.id
(async () => {
  try {
    const dt = (
      await db.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'")
    ).rows[0]?.data_type;
    const idType = { integer: "INTEGER", bigint: "BIGINT", uuid: "UUID" }[dt] || "INTEGER";
    await db.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id ${idType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  } catch (e) {
    console.error("Could not create password_resets table:", e.message);
  }
})();

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

async function sendResetEmail(to, link) {
  if (!mailer) {
    if (isProd) throw new Error("SMTP_HOST is not set in .env, cannot send email");
    console.log(`\n[DEV] No SMTP set. Password reset link for ${to}:\n${link}\n`);
    return;
  }
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: "إعادة تعيين كلمة المرور — منصة تعلَّم",
    text: `طلبت إعادة تعيين كلمة المرور لحسابك في منصة تعلَّم.\n\nافتح الرابط التالي (صالح لمدة ${RESET_MINUTES} دقيقة):\n${link}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغير شيء في حسابك.`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#0D47A1">
      <h2>إعادة تعيين كلمة المرور</h2>
      <p>طلبت إعادة تعيين كلمة المرور لحسابك في منصة تعلَّم.</p>
      <p><a href="${link}" style="display:inline-block;background:#0D47A1;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">اختر كلمة مرور جديدة</a></p>
      <p style="font-size:13px">الرابط صالح لمدة ${RESET_MINUTES} دقيقة ويعمل مرة واحدة فقط.</p>
      <p style="font-size:13px;color:#555">إذا لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغير شيء في حسابك.</p></div>`,
  });
}

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).send("محاولات كثيرة، حاول مرة أخرى بعد قليل."),
});

app.get("/forgot", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/dashboard");
  res.render("forgot.ejs", { sent: false, error: authErrors[req.query.error] || null });
});

app.post("/forgot", limiter("/forgot"), async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.render("forgot.ejs", { sent: false, error: "البريد الإلكتروني غير صالح." });

  // Same answer whether or not the account exists, and sent before any work,
  // so nobody can use this page to find out which emails are registered.
  res.render("forgot.ejs", { sent: true, error: null });

  try {
    await db.query("DELETE FROM password_resets WHERE expires_at < now()");
    const user = (await db.query("SELECT id, email FROM users WHERE email = $1", [email])).rows[0];
    if (!user) return;
    const recent = await db.query(
      "SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '60 seconds'",
      [user.id]
    );
    if (recent.rowCount) return; // stops someone from flooding an inbox
    const token = crypto.randomBytes(32).toString("hex");
    await db.query("DELETE FROM password_resets WHERE user_id = $1", [user.id]); // only the newest link works
    await db.query(
      "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3::int))",
      [user.id, sha256(token), RESET_MINUTES]
    );
    await sendResetEmail(user.email, `${BASE_URL}/reset/${token}`);
  } catch (e) {
    console.error("forgot-password failed:", e.message);
  }
});

async function findReset(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await db.query(
    "SELECT id FROM password_resets WHERE token_hash = $1 AND expires_at > now()",
    [sha256(token)]
  );
  return rows[0] || null;
}

app.get("/reset/:token", resetLimiter, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const valid = !!(await findReset(req.params.token));
  res.render("reset.ejs", { token: req.params.token, valid, error: null });
});

app.post("/reset/:token", resetLimiter, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const token = req.params.token;
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const confirm = typeof req.body.confirm === "string" ? req.body.confirm : "";
  const fail = (msg) => res.render("reset.ejs", { token, valid: true, error: msg });
  const expired = () => res.render("reset.ejs", { token, valid: false, error: null });

  if (!(await findReset(token))) return expired();
  if (password.length < 8) return fail("كلمة المرور يجب ألا تقل عن 8 أحرف.");
  if (Buffer.byteLength(password) > 72) return fail("كلمة المرور طويلة جداً.");
  if (password !== confirm) return fail("كلمتا المرور غير متطابقتين.");

  const hash = await bcrypt.hash(password, saltRounds);
  const client = await db.connect();
  let userId;
  try {
    await client.query("BEGIN");
    // DELETE ... RETURNING uses the token up atomically, so the link works only once
    const row = (
      await client.query(
        "DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
        [sha256(token)]
      )
    ).rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return expired();
    }
    userId = row.user_id;
    await client.query("UPDATE users SET password = $1 WHERE id = $2", [hash, userId]);
    await client.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    return fail("حدث خطأ غير متوقع، حاول مرة أخرى.");
  } finally {
    client.release();
  }

  // sign the account out everywhere (e.g. if someone else was logged in)
  try {
    await db.query("DELETE FROM session WHERE sess -> 'passport' ->> 'user' = $1::text", [String(userId)]);
  } catch (e) {
    console.error("Could not clear old sessions:", e.message);
  }
  res.redirect("/login?notice=" + encodeURIComponent("تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة."));
});

/* ---------- student ---------- */
app.get("/profile", requireRole("student"), async (req, res) => {
  const student = (await db.query("SELECT * FROM students WHERE user_id = $1", [req.user.id])).rows[0];
  const { rows } = await db.query(
    `SELECT b.id, b.status, ${SLOT_COLS}, a.join_url, t.title, t.full_name, t.subject
       FROM bookings b
       JOIN teacher_availability a ON a.id = b.availability_id
       JOIN teachers t ON t.user_id = a.teacher_id
      WHERE b.student_id = $1
      ORDER BY a.slot_datetime`,
    [req.user.id]
  );
  const upcoming = rows.filter((r) => r.status === "confirmed" && isUpcoming(r));
  const history = rows.filter((r) => !upcoming.includes(r)).reverse();
  const stats = {
    total: rows.length,
    upcoming: upcoming.length,
    completed: history.filter((r) => r.status === "confirmed" || r.status === "completed").length,
    canceled: rows.filter((r) => r.status === "cancelled").length,
  };
  res.render("profile.ejs", { student, upcoming, history, stats });
});

app.get("/book", requireRole("student"), async (req, res) => {
  const subject = str(req.query.subject).slice(0, 60); // search by subject
  const q = str(req.query.q).slice(0, 60);             // search by teacher name

  const subjects = (
    await db.query("SELECT DISTINCT subject FROM teachers WHERE COALESCE(subject, '') <> '' ORDER BY subject")
  ).rows.map((r) => r.subject);

  // same teacher filter is used for both queries below
  const FILTER = `($1::text = '' OR ${NORM("t.subject")} LIKE ${NORM("$2::text")})
              AND ($3::text = '' OR ${NORM("t.full_name")} LIKE ${NORM("$4::text")})`;
  const filterParams = [subject, likeOf(subject), q, likeOf(q)];

  const teachers = (
    await db.query(
      `SELECT t.user_id, t.title, t.full_name, t.subject, t.photo
         FROM teachers t
        WHERE ${FILTER}
        ORDER BY t.full_name
        LIMIT 60`,
      filterParams
    )
  ).rows;

  const slots = teachers.length
    ? (
        await db.query(
          `SELECT a.id, a.teacher_id, ${SLOT_COLS}, a.capacity, (a.join_url IS NOT NULL) AS has_meeting,
                  a.capacity - (SELECT COUNT(*) FROM bookings b2
                                 WHERE b2.availability_id = a.id AND b2.status = 'confirmed')::int AS seats_left
             FROM teacher_availability a
             JOIN teachers t ON t.user_id = a.teacher_id
            WHERE ${FILTER}
              AND a.status = 'available' AND a.slot_datetime >= $5::timestamp
              AND NOT EXISTS (SELECT 1 FROM bookings b
                               WHERE b.availability_id = a.id AND b.student_id = $6 AND b.status = 'confirmed')
            ORDER BY a.slot_datetime
            LIMIT 400`,
          [...filterParams, nowLocal(), req.user.id]
        )
      ).rows
    : [];

  const slotsBy = {};
  slots.forEach((s) => (slotsBy[s.teacher_id] ||= []).push(s));

  res.render("book.ejs", { teachers, slotsBy, subjects, subject, q });
});

app.post("/book/:id", requireRole("student"), async (req, res) => {
  const unavailable = "/book?error=" + encodeURIComponent("عذراً، هذا الموعد لم يعد متاحاً.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // lock the slot row so two students can't take the last seat at the same time
    const slot = (
      await client.query(
        `SELECT id, capacity FROM teacher_availability
          WHERE id = $1 AND status = 'available' AND slot_datetime >= $2::timestamp
          FOR UPDATE`,
        [req.params.id, nowLocal()]
      )
    ).rows[0];
    if (!slot) {
      await client.query("ROLLBACK");
      return res.redirect(unavailable);
    }
    const taken = (
      await client.query(
        `SELECT COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE student_id = $2))::int AS mine
           FROM bookings WHERE availability_id = $1 AND status = 'confirmed'`,
        [slot.id, req.user.id]
      )
    ).rows[0];
    if (taken.mine) {
      await client.query("ROLLBACK");
      return res.redirect("/book?error=" + encodeURIComponent("لقد حجزت هذا الموعد مسبقاً."));
    }
    if (taken.n >= slot.capacity) {
      await client.query("ROLLBACK");
      return res.redirect(unavailable);
    }
    await client.query(
      "INSERT INTO bookings (availability_id, student_id, status) VALUES ($1, $2, 'confirmed')",
      [slot.id, req.user.id]
    );
    if (taken.n + 1 >= slot.capacity) {
      await client.query("UPDATE teacher_availability SET status = 'booked' WHERE id = $1", [slot.id]);
    }
    await client.query("COMMIT");
    res.redirect("/profile?notice=" + encodeURIComponent("تم تأكيد حجزك بنجاح."));
  } catch (err) {
  await client.query("ROLLBACK").catch(() => {});
if (err.code === "23505")
  return res.redirect("/book?error=" + encodeURIComponent("لقد حجزت هذا الموعد مسبقاً."));
console.error(err);
res.redirect("/book?error=" + encodeURIComponent("تعذر إتمام الحجز، حاول مرة أخرى."));
  } finally {
    client.release();
  }
});

// Student or teacher can cancel a confirmed booking they own
app.post("/bookings/:id/cancel", ensureAuthenticated, async (req, res) => {
  const home = req.user.role === "teacher" ? "/teacher" : "/profile";
  const ownerQuery =
    req.user.role === "student"
      ? `SELECT b.id, b.availability_id FROM bookings b
          WHERE b.id = $1 AND b.student_id = $2 AND b.status = 'confirmed'`
      : `SELECT b.id, b.availability_id FROM bookings b
           JOIN teacher_availability a ON a.id = b.availability_id
          WHERE b.id = $1 AND a.teacher_id = $2 AND b.status = 'confirmed'`;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(ownerQuery, [req.params.id, req.user.id]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return res.redirect(home + "?error=" + encodeURIComponent("الحجز غير موجود."));
    }

    // ===== EDIT: REPLACE your two UPDATE queries with everything in this block =====
    const slotId = found.rows[0].availability_id;

    // same lock the booking route uses, so a cancel and a booking can't interleave
    await client.query("SELECT id FROM teacher_availability WHERE id = $1 FOR UPDATE", [slotId]);

    await client.query(
      "UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed'",
      [req.params.id]
    );

    // reopen the slot only if it is 'booked' AND a seat is actually free now
    await client.query(
      `UPDATE teacher_availability a SET status = 'available'
        WHERE a.id = $1 AND a.status = 'booked'
          AND (SELECT COUNT(*) FROM bookings b
                WHERE b.availability_id = a.id AND b.status = 'confirmed') < a.capacity`,
      [slotId]
    );
    // ===============================================================================

    await client.query("COMMIT");
    res.redirect(home + "?notice=" + encodeURIComponent("تم إلغاء الحجز."));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.redirect(home + "?error=" + encodeURIComponent("تعذر إلغاء الحجز."));
  } finally {
    client.release();
  }
});
/* ---------- Zoom: each teacher connects their own Zoom account ---------- */
const ZOOM_ID = process.env.ZOOM_CLIENT_ID || "";
const ZOOM_SECRET = process.env.ZOOM_CLIENT_SECRET || "";
const ZOOM_REDIRECT = process.env.ZOOM_REDIRECT_URI || `http://localhost:${port}/zoom/callback`;
const ZOOM_TZ = process.env.ZOOM_TIMEZONE || APP_TZ;
const zoomEnabled = !!(ZOOM_ID && ZOOM_SECRET);
// only real Zoom links are accepted when a teacher pastes one (students will click it)
const ZOOM_LINK_RE = /^https:\/\/([a-z0-9-]+\.)*zoom\.(us|com)\/[^\s]*$/i;

// Zoom tokens are stored encrypted (AES-256-GCM). Changing ZOOM_TOKEN_KEY / SESSION_SECRET disconnects teachers.
const ZKEY = crypto.createHash("sha256").update(process.env.ZOOM_TOKEN_KEY || process.env.SESSION_SECRET).digest();
const seal = (txt) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ZKEY, iv);
  const enc = Buffer.concat([c.update(txt, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};
const unseal = (str_) => {
  const [iv, tag, enc] = str_.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", ZKEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
};

// columns + table are created on start (safe to run every time)
(async () => {
  try {
    await db.query("ALTER TABLE teacher_availability ADD COLUMN IF NOT EXISTS join_url TEXT");
    await db.query("ALTER TABLE teacher_availability ADD COLUMN IF NOT EXISTS zoom_meeting_id TEXT");
    const dt = (
      await db.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'")
    ).rows[0]?.data_type;
    const idType = { integer: "INTEGER", bigint: "BIGINT", uuid: "UUID" }[dt] || "INTEGER";
    await db.query(`CREATE TABLE IF NOT EXISTS teacher_zoom (
      teacher_id ${idType} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  } catch (e) {
    console.error("Zoom setup (columns/table) failed:", e.message);
  }
})();

const zoomBasic = () => "Basic " + Buffer.from(`${ZOOM_ID}:${ZOOM_SECRET}`).toString("base64");

async function zoomOAuth(params) {
  const r = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: zoomBasic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const err = new Error(data.reason || data.error || `Zoom OAuth ${r.status}`);
    err.zoomAuth = r.status === 400 || r.status === 401; // the connection itself is no longer valid
    throw err;
  }
  return data;
}

async function saveZoomTokens(teacherId, d) {
  await db.query(
    `INSERT INTO teacher_zoom (teacher_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::int))
     ON CONFLICT (teacher_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at`,
    [teacherId, seal(d.access_token), seal(d.refresh_token), Math.max(60, (d.expires_in || 3600) - 60)]
  );
}

async function zoomConnected(teacherId) {
  try {
    return (await db.query("SELECT 1 FROM teacher_zoom WHERE teacher_id = $1", [teacherId])).rowCount > 0;
  } catch (e) {
    return false;
  }
}

// Zoom gives a NEW refresh token every time it is used, so two refreshes at once would break the link: one at a time per teacher
const refreshing = new Map();
async function zoomAccessToken(teacherId, force = false) {
  const row = (
    await db.query(
      "SELECT access_token, refresh_token, (expires_at > now() + interval '60 seconds') AS fresh FROM teacher_zoom WHERE teacher_id = $1",
      [teacherId]
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Zoom is not connected"), { zoomAuth: true });
  if (row.fresh && !force) return unseal(row.access_token);
  if (!refreshing.has(teacherId)) {
    refreshing.set(
      teacherId,
      (async () => {
        try {
          const d = await zoomOAuth({ grant_type: "refresh_token", refresh_token: unseal(row.refresh_token) });
          await saveZoomTokens(teacherId, d);
          return d.access_token;
        } catch (e) {
          if (e.zoomAuth) await db.query("DELETE FROM teacher_zoom WHERE teacher_id = $1", [teacherId]).catch(() => {});
          throw e;
        } finally {
          refreshing.delete(teacherId);
        }
      })()
    );
  }
  return refreshing.get(teacherId);
}

async function zoomApi(teacherId, method, urlPath, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await zoomAccessToken(teacherId, attempt === 1);
    const r = await fetch("https://api.zoom.us/v2" + urlPath, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && attempt === 0) continue; // token was rejected: refresh once and retry
    if (r.status === 204) return null;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Zoom API ${r.status}: ${data.message || ""}`);
    return data;
  }
}

const createZoomMeeting = (teacherId, { topic, date, time, minutes }) =>
  zoomApi(teacherId, "POST", "/users/me/meetings", {
    topic,
    type: 2, // scheduled meeting
    start_time: `${date}T${time}:00`, // local time, read in the timezone below
    duration: minutes,
    timezone: ZOOM_TZ,
    settings: { waiting_room: true, join_before_host: false, mute_upon_entry: true },
  });
const deleteZoomMeeting = (teacherId, meetingId) => zoomApi(teacherId, "DELETE", `/meetings/${encodeURIComponent(meetingId)}`);

app.get("/teacher/zoom/connect", requireRole("teacher"), (req, res) => {
  if (!zoomEnabled) return res.redirect("/teacher?error=" + encodeURIComponent("ربط Zoom غير مفعّل على الموقع بعد."));
  const state = crypto.randomBytes(16).toString("hex");
  req.session.zoomState = state;
  const url = new URL("https://zoom.us/oauth/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: ZOOM_ID, redirect_uri: ZOOM_REDIRECT, state }).toString();
  req.session.save(() => res.redirect(url.toString()));
});

app.get("/zoom/callback", requireRole("teacher"), async (req, res) => {
  const back = (type, msg) => res.redirect(`/teacher?${type}=${encodeURIComponent(msg)}`);
  const { code, state, error } = req.query;
  const expected = req.session.zoomState;
  delete req.session.zoomState;
  if (error) return back("error", "تم إلغاء ربط Zoom.");
  if (typeof code !== "string" || typeof state !== "string" || !expected || state !== expected)
    return back("error", "تعذر التحقق من طلب الربط، حاول مرة أخرى.");
  try {
    const d = await zoomOAuth({ grant_type: "authorization_code", code, redirect_uri: ZOOM_REDIRECT });
    await saveZoomTokens(req.user.id, d);
    back("notice", "تم ربط حساب Zoom. ستُنشأ الاجتماعات تلقائياً عند نشر المواعيد.");
  } catch (e) {
    console.error("Zoom connect failed:", e.message);
    back("error", "تعذر ربط حساب Zoom.");
  }
});

app.post("/teacher/zoom/disconnect", requireRole("teacher"), async (req, res) => {
  try {
    const row = (await db.query("SELECT access_token FROM teacher_zoom WHERE teacher_id = $1", [req.user.id])).rows[0];
    if (row) {
      // tell Zoom to cancel the connection too (best effort)
      fetch("https://zoom.us/oauth/revoke", {
        method: "POST",
        headers: { Authorization: zoomBasic(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: unseal(row.access_token) }),
      }).catch(() => {});
      await db.query("DELETE FROM teacher_zoom WHERE teacher_id = $1", [req.user.id]);
    }
    res.redirect("/teacher?notice=" + encodeURIComponent("تم فصل حساب Zoom."));
  } catch (e) {
    console.error(e);
    res.redirect("/teacher?error=" + encodeURIComponent("تعذر فصل حساب Zoom."));
  }
});

/* ---------- teacher ---------- */
app.get("/teacher", requireRole("teacher"), async (req, res) => {
  const tid = req.user.id;
  const now = nowLocal();
  const today = ymd(wallNow());
  const teacher = (await db.query("SELECT * FROM teachers WHERE user_id = $1", [tid])).rows[0];

   const DAYS = 7; // today + the next 6 days, so Saturday and Sunday always appear
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = wallNow();
    d.setDate(d.getDate() + i);
    days.push({
      key: ymd(d),
      name: d.toLocaleDateString("ar", { weekday: "long" }),
      label: d.toLocaleDateString("ar", { day: "numeric", month: "long" }),
      isToday: i === 0,
      slots: [],
    });
  }

  // one row per slot; student names are joined into f_name so teacher.ejs works unchanged
  const slots = (
    await db.query(
     `SELECT a.id, ${SLOT_COLS}, a.capacity, a.join_url,
        COUNT(b.id)::int AS booked_count,
        (COUNT(b.id) >= a.capacity) AS is_booked,
        COALESCE(string_agg(s.f_name || ' ' || s.l_name, '، ' ORDER BY b.created_at), '') AS f_name,
        '' AS l_name
   FROM teacher_availability a
   LEFT JOIN bookings b ON b.availability_id = a.id AND b.status = 'confirmed'
   LEFT JOIN students s ON s.user_id = b.student_id
  WHERE a.teacher_id = $1 AND a.status <> 'cancelled'
    AND a.slot_datetime::date BETWEEN $2::date AND $3::date
  GROUP BY a.id, a.slot_datetime, a.duration_minutes, a.capacity, a.join_url
  ORDER BY a.slot_datetime`,
      [tid, days[0].key, days[DAYS - 1].key]
    )
  ).rows;
  slots.forEach((s) => days.find((d) => d.key === s.slot_date)?.slots.push(s));
  const stats = (
    await db.query(
      `SELECT
         (SELECT COUNT(*) FROM teacher_availability
           WHERE teacher_id = $1 AND status = 'available' AND slot_datetime >= $2::timestamp) AS open_slots,
         COUNT(*) FILTER (WHERE b.status = 'confirmed' AND a.slot_datetime >= $2::timestamp) AS upcoming,
         COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'completed')) AS confirmed_total,
         COUNT(*) FILTER (WHERE b.status = 'cancelled') AS canceled_total
       FROM bookings b JOIN teacher_availability a ON a.id = b.availability_id
       WHERE a.teacher_id = $1`,
      [tid, now]
    )
  ).rows[0];

  const bookings = (
    await db.query(
      `SELECT b.id, b.status, ${SLOT_COLS},
              s.f_name, s.l_name, s.phone_number, u.email
         FROM bookings b
         JOIN teacher_availability a ON a.id = b.availability_id
         JOIN students s ON s.user_id = b.student_id
         JOIN users u ON u.id = s.user_id
        WHERE a.teacher_id = $1 AND a.slot_datetime::date >= $2::date
        ORDER BY a.slot_datetime
        LIMIT 50`,
      [tid, today]
    )
  ).rows;
  const nextSession = bookings.find((b) => b.status === "confirmed" && isUpcoming(b)) || null;

  const zoom = { enabled: zoomEnabled, connected: zoomEnabled && (await zoomConnected(tid)) };
  res.render("teacher.ejs", { teacher, days, stats, bookings, nextSession, today, zoom });
});

app.post("/teacher/slots", requireRole("teacher"), async (req, res) => {
  const slot_date = str(req.body.slot_date);
  const start_time = str(req.body.start_time).slice(0, 5);
  const end_time = str(req.body.end_time).slice(0, 5);
  const back = (type, msg) => res.redirect(`/teacher?${type}=${encodeURIComponent(msg)}`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot_date) || !/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time))
    return back("error", "الرجاء تعبئة جميع الحقول.");
  if (end_time <= start_time) return back("error", "وقت النهاية يجب أن يكون بعد وقت البداية.");
  if (new Date(`${slot_date}T${start_time}`) < wallNow()) return back("error", "لا يمكن إضافة موعد في الماضي.");

  const capacity = parseInt(req.body.capacity, 10);
if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50)
  return back("error", "عدد الطلاب يجب أن يكون بين 1 و 50.");
  
  const toMin = (t) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
  const duration = toMin(end_time) - toMin(start_time);

  const overlap = await db.query(
    `SELECT 1 FROM teacher_availability
      WHERE teacher_id = $1 AND status <> 'cancelled'
        AND slot_datetime < ($2::date + $4::time)
        AND slot_datetime + make_interval(mins => COALESCE(duration_minutes, 60)) > ($2::date + $3::time)`,
    [req.user.id, slot_date, start_time, end_time]
  );
  if (overlap.rowCount) return back("error", "هذا الموعد يتداخل مع موعد موجود.");

  // meeting link: pasted by the teacher, or created on the teacher's own Zoom account
  let joinUrl = str(req.body.meeting_url);
  let zoomId = null;
  if (joinUrl) {
    if (joinUrl.length > 500 || !ZOOM_LINK_RE.test(joinUrl))
      return back("error", "رابط الاجتماع يجب أن يكون رابط Zoom صحيحاً مثل https://zoom.us/j/...");
  } else if (zoomEnabled && (await zoomConnected(req.user.id))) {
    try {
      const t = (await db.query("SELECT full_name, subject FROM teachers WHERE user_id = $1", [req.user.id])).rows[0] || {};
      const m = await createZoomMeeting(req.user.id, {
        topic: [t.subject || "حصة", t.full_name].filter(Boolean).join(" — "),
        date: slot_date,
        time: start_time,
        minutes: duration,
      });
      joinUrl = m.join_url;
      zoomId = String(m.id);
    } catch (e) {
      console.error("Zoom meeting failed:", e.message);
      return back("error", "تعذر إنشاء اجتماع Zoom. أعد ربط حسابك، أو الصق رابط اجتماع Zoom يدوياً في الحقل.");
    }
  }

  try {
    await db.query(
      `INSERT INTO teacher_availability (teacher_id, slot_datetime, duration_minutes, status, capacity, join_url, zoom_meeting_id)
       VALUES ($1, $2::date + $3::time, $4, 'available', $5, $6, $7)`,
      [req.user.id, slot_date, start_time, duration, capacity, joinUrl || null, zoomId]
    );
  } catch (e) {
    console.error(e);
    if (zoomId) deleteZoomMeeting(req.user.id, zoomId).catch(() => {});
    return back("error", "تعذر نشر الموعد.");
  }
  back("notice", joinUrl ? "تم نشر الموعد مع رابط Zoom." : "تم نشر الموعد بنجاح (بدون رابط Zoom).");
});

// "delete" = mark cancelled, only if nobody has a confirmed booking on it
app.post("/teacher/slots/:id/delete", requireRole("teacher"), async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.redirect("/teacher");
  let zoomId = null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const slot = await client.query(
      `SELECT id, zoom_meeting_id FROM teacher_availability
        WHERE id = $1 AND teacher_id = $2 AND status = 'available' FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (slot.rowCount) {
      const { n } = (await client.query(
        "SELECT COUNT(*)::int AS n FROM bookings WHERE availability_id = $1 AND status = 'confirmed'",
        [req.params.id]
      )).rows[0];
      if (n === 0) {
        await client.query("UPDATE teacher_availability SET status = 'cancelled' WHERE id = $1", [req.params.id]);
        zoomId = slot.rows[0].zoom_meeting_id;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
  } finally {
    client.release();
  }
  if (zoomId) deleteZoomMeeting(req.user.id, zoomId).catch((e) => console.error("Zoom delete failed:", e.message));
  res.redirect("/teacher");
});

app.post("/teacher/photo", requireRole("teacher"), (req, res) => {
  const back = (type, msg) => res.redirect(`/teacher?${type}=${encodeURIComponent(msg)}`);
  photoUpload(req, res, async (err) => {
    if (err)
      return back("error", err.code === "LIMIT_FILE_SIZE" ? "حجم الصورة يجب ألا يتجاوز 2 ميجابايت." : "تعذر رفع الصورة.");
    if (!req.file) return back("error", "الرجاء اختيار صورة.");
    const ext = imageType(req.file.buffer);
    if (!ext) return back("error", "الصيغة غير مدعومة. استخدم JPG أو PNG أو WEBP.");
    try {
      const name = `${req.user.id}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
      const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
      await db.query("INSERT INTO teacher_photos (name, mime, data) VALUES ($1, $2, $3)", [name, MIME[ext], req.file.buffer]);
      const old = (await db.query("SELECT photo FROM teachers WHERE user_id = $1", [req.user.id])).rows[0]?.photo;
      await db.query("UPDATE teachers SET photo = $1 WHERE user_id = $2", [name, req.user.id]);
      removePhoto(old);
      back("notice", "تم تحديث صورتك الشخصية.");
    } catch (e) {
      console.error(e);
      back("error", "تعذر حفظ الصورة.");
    }
  });
});

app.post("/teacher/photo/delete", requireRole("teacher"), async (req, res) => {
  try {
    const old = (await db.query("SELECT photo FROM teachers WHERE user_id = $1", [req.user.id])).rows[0]?.photo;
    await db.query("UPDATE teachers SET photo = NULL WHERE user_id = $1", [req.user.id]);
    removePhoto(old);
    res.redirect("/teacher?notice=" + encodeURIComponent("تم حذف الصورة."));
  } catch (e) {
    console.error(e);
    res.redirect("/teacher?error=" + encodeURIComponent("تعذر حذف الصورة."));
  }
});

/* ---------- moderator ---------- */
app.get("/admin", requireRole("moderator"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.user_id, t.title, t.full_name, t.subject, t.photo, t.phone_number, u.email, u.created_at
       FROM teachers t JOIN users u ON u.id = t.user_id
      ORDER BY u.created_at DESC`
  );
  res.render("admin.ejs", { teachers: rows });
});

app.post("/admin/teachers", requireRole("moderator"), async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const title = str(req.body.title);
  const full_name = str(req.body.full_name);
  const phone_number = str(req.body.phone_number);
  const subject = str(req.body.subject);
  const back = (type, msg) => res.redirect(`/admin?${type}=${encodeURIComponent(msg)}`);

  if (!EMAIL_RE.test(email) || email.length > 254) return back("error", "البريد الإلكتروني غير صالح.");
  if (password.length < 8) return back("error", "كلمة المرور يجب ألا تقل عن 8 أحرف.");
  if (Buffer.byteLength(password) > 72) return back("error", "كلمة المرور طويلة جداً.");
  if (!full_name || !subject) return back("error", "الرجاء إدخال الاسم الكامل والمادة.");
  if (!/^[0-9+\s-]{7,20}$/.test(phone_number)) return back("error", "رقم الجوال غير صالح.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, saltRounds);
    const { rows } = await client.query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, 'teacher') RETURNING id",
      [email, hash]
    );
    await client.query(
      "INSERT INTO teachers (user_id, title, full_name, phone_number, subject) VALUES ($1, $2, $3, $4, $5)",
      [rows[0].id, title, full_name, phone_number, subject]
    );
    await client.query("COMMIT");
    back("notice", "تم إنشاء حساب المعلم بنجاح.");
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return back("error", "هذا البريد الإلكتروني مسجل مسبقاً.");
    console.error(err);
    back("error", "تعذر إنشاء الحساب.");
  } finally {
    if (client) client.release();
  }
});

// Moderator removes a teacher. Confirmed upcoming bookings are cancelled (the slots are deleted with the teacher).
app.post("/admin/teachers/:id/delete", requireRole("moderator"), async (req, res) => {
  const back = (type, msg) => res.redirect(`/admin?${type}=${encodeURIComponent(msg)}`);
  const id = String(req.params.id || "");
  if (!/^[0-9a-fA-F-]{1,64}$/.test(id)) return back("error", "معلم غير موجود.");

  // 1) make sure it really is a teacher (never lets the moderator delete a student or themselves)
  let teacher;
  try {
    teacher = (
      await db.query(
        `SELECT u.id, t.photo FROM users u LEFT JOIN teachers t ON t.user_id = u.id
          WHERE u.id = $1 AND u.role = 'teacher'`,
        [id]
      )
    ).rows[0];
  } catch (e) {
    console.error(e);
    return back("error", "تعذر حذف المعلم.");
  }
  if (!teacher) return back("error", "معلم غير موجود.");

  // 2) Zoom cleanup BEFORE the database rows go (it needs the teacher's saved Zoom connection). Best effort only.
  if (zoomEnabled) {
    try {
      const metas = (
        await db.query(
          `SELECT zoom_meeting_id FROM teacher_availability
            WHERE teacher_id = $1 AND zoom_meeting_id IS NOT NULL AND status <> 'cancelled'
              AND slot_datetime >= $2::timestamp LIMIT 200`,
          [id, nowLocal()]
        )
      ).rows;
      await Promise.allSettled(metas.map((m) => deleteZoomMeeting(id, m.zoom_meeting_id)));
      const z = (await db.query("SELECT access_token FROM teacher_zoom WHERE teacher_id = $1", [id])).rows[0];
      if (z) {
        await fetch("https://zoom.us/oauth/revoke", {
          method: "POST",
          headers: { Authorization: zoomBasic(), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: unseal(z.access_token) }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Zoom cleanup while removing teacher failed:", e.message);
    }
  }

  // 3) delete everything that belongs to the teacher in ONE transaction (all or nothing)
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cancelled = (
      await client.query(
        `SELECT COUNT(*)::int AS n FROM bookings b
           JOIN teacher_availability a ON a.id = b.availability_id
          WHERE a.teacher_id = $1 AND b.status = 'confirmed' AND a.slot_datetime >= $2::timestamp`,
        [id, nowLocal()]
      )
    ).rows[0].n;
    await client.query(
      "DELETE FROM bookings WHERE availability_id IN (SELECT id FROM teacher_availability WHERE teacher_id = $1)",
      [id]
    );
    await client.query("DELETE FROM teacher_availability WHERE teacher_id = $1", [id]);
    await client.query("DELETE FROM teacher_zoom WHERE teacher_id = $1", [id]);
    await client.query("DELETE FROM teachers WHERE user_id = $1", [id]);
    await client.query("DELETE FROM users WHERE id = $1 AND role = 'teacher'", [id]);
    // log the removed teacher out everywhere
    await client.query("DELETE FROM session WHERE sess -> 'passport' ->> 'user' = $1::text", [id]);
    await client.query("COMMIT");
    removePhoto(teacher.photo);
    back("notice", cancelled ? `تم حذف المعلم وإلغاء ${cancelled} حجز قادم.` : "تم حذف المعلم.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Remove teacher failed:", err.message);
    back("error", "تعذر حذف المعلم.");
  } finally {
    client.release();
  }
});

/* ---------- passport (FIX: was missing, login can't work without it) ---------- */
passport.use(
  "local",
  new Strategy({ usernameField: "email" }, async (email, password, cb) => {
    try {
      const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [str(email).toLowerCase()]);
      const user = rows[0];
      const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
      if (!user || !ok) return cb(null, false);
      cb(null, { id: user.id, email: user.email, role: user.role, created_at: user.created_at });
    } catch (err) {
      cb(err);
    }
  })
);

passport.serializeUser((user, cb) => cb(null, user.id));
passport.deserializeUser(async (id, cb) => {
  try {
    const { rows } = await db.query("SELECT id, email, role, created_at FROM users WHERE id = $1", [id]);
    cb(null, rows[0] || false);
  } catch (err) {
    cb(err);
  }
});

app.use((req, res) => res.status(404).send("الصفحة غير موجودة"));

async function seedModerator() {
  const email = str(process.env.MODERATOR_EMAIL).toLowerCase();
  const pass = process.env.MODERATOR_PASSWORD || "";
  const exists = await db.query("SELECT 1 FROM users WHERE role = 'moderator'");
  if (exists.rowCount) return;
  if (!email || pass.length < 8) {
    console.warn("No moderator yet: set MODERATOR_EMAIL and MODERATOR_PASSWORD (8+ chars) in .env");
    return;
  }
  const hash = await bcrypt.hash(pass, saltRounds);
  const r = await db.query(
    "INSERT INTO users (email, password, role) VALUES ($1, $2, 'moderator') ON CONFLICT DO NOTHING",
    [email, hash]
  );
  console.log(r.rowCount ? `Moderator account created: ${email}` : "Moderator NOT created: that email is already registered");
}
seedModerator().catch((e) => console.error("Moderator seed failed:", e));

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

export default app; // Vercel runs the app through this export