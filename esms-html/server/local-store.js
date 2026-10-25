import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const state = globalThis;
async function initialize() {
  const directory =
    process.env.ESMS_DATA_DIR || path.join(process.cwd(), ".esms-data");
  await mkdir(directory, { recursive: true });
  const db = new PGlite(path.join(directory, "database"));
  await db.exec(
    `create schema if not exists local_meta;create table if not exists local_meta.migrations(name text primary key);`,
  );
  const applied = await db.query("select name from local_meta.migrations");
  if (!applied.rows.some((r) => r.name === "bootstrap")) {
    await db.exec(`
   create role anon nologin;create role authenticated nologin;
   create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text not null unique,password_hash text not null,raw_user_meta_data jsonb not null default '{}');
   create table auth.sessions(token_hash text primary key,user_id uuid references auth.users(id) on delete cascade,expires_at timestamptz not null);
   create table auth.attempts(key text primary key,count integer not null,started_at timestamptz not null);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,public,storage to anon,authenticated;
   grant execute on function auth.uid() to anon,authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,object_data bytea not null,mime_type text not null,unique(bucket_id,name));
   alter table storage.objects enable row level security;
   grant select,insert,update,delete on storage.objects to authenticated;
   insert into local_meta.migrations values('bootstrap');
  `);
  }
  for (const name of [
    "202610240001_esms.sql",
    "202610240002_registration.sql",
  ]) {
    if (applied.rows.some((r) => r.name === name)) continue;
    const sql = await readFile(
      path.join(process.cwd(), "supabase", "migrations", name),
      "utf8",
    );
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into local_meta.migrations values($1)", [name]);
    });
  }
  return db;
}
export function localDatabase() {
  return (state.esmsLocalDatabase ??= initialize());
}
export async function withIdentity(userId, work) {
  const db = await localDatabase();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId ?? "",
    ]);
    await tx.exec(
      userId ? "set local role authenticated" : "set local role anon",
    );
    return work(tx);
  });
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password, encoded) {
  const [salt, key] = encoded.split(":");
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export async function throttle(key, limit) {
  const db = await localDatabase();
  const result = await db.query(
    `insert into auth.attempts(key,count,started_at) values($1,1,now()) on conflict(key) do update set count=case when auth.attempts.started_at<now()-interval '15 minutes' then 1 else auth.attempts.count+1 end,started_at=case when auth.attempts.started_at<now()-interval '15 minutes' then now() else auth.attempts.started_at end returning count`,
    [hash(key)],
  );
  if (result.rows[0].count > limit)
    throw new Error("Trop de tentatives. Réessayez dans 15 minutes.");
}
export async function registerLocal(email, password, metadata) {
  await throttle("signup-global", 30);
  const db = await localDatabase();
  const id = randomUUID();
  await db.query(
    "insert into auth.users(id,email,password_hash,raw_user_meta_data) values($1,$2,$3,$4)",
    [id, email, await passwordHash(password), JSON.stringify(metadata)],
  );
  return { id, email };
}
export async function authenticateLocal(email, password) {
  await throttle(`login:${email}`, 15);
  await throttle("login-global", 150);
  const db = await localDatabase();
  const result = await db.query(
    "select id,email,password_hash from auth.users where email=$1",
    [email],
  );
  const row = result.rows[0];
  // Also perform password derivation for unknown usernames.
  const encoded = row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`;
  if (!(await passwordMatches(password, encoded)) || !row)
    throw new Error("Nom d’utilisateur ou mot de passe incorrect.");
  return { id: row.id, email: row.email };
}
export async function newSession(userId) {
  const db = await localDatabase();
  const token = randomBytes(32).toString("hex");
  await db.query("delete from auth.sessions where expires_at<now()");
  await db.query(
    "insert into auth.sessions values($1,$2,now()+interval '7 days')",
    [hash(token), userId],
  );
  return token;
}
export async function sessionUser(token) {
  if (!token) return null;
  const db = await localDatabase();
  const result = await db.query(
    `select u.id,u.email from auth.sessions s join auth.users u on u.id=s.user_id join public.profiles p on p.id=u.id where s.token_hash=$1 and s.expires_at>now() and p.active`,
    [hash(token)],
  );
  return result.rows[0] ?? null;
}
export async function revokeSession(token) {
  if (token) {
    const db = await localDatabase();
    await db.query("delete from auth.sessions where token_hash=$1", [
      hash(token),
    ]);
  }
}
export async function updateLocalPassword(userId, password) {
  const db = await localDatabase();
  await db.transaction(async (tx) => {
    await tx.query("update auth.users set password_hash=$1 where id=$2", [
      await passwordHash(password),
      userId,
    ]);
    await tx.query("delete from auth.sessions where user_id=$1", [userId]);
  });
}
