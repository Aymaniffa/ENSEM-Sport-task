import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { localClient } from "./local-client.js";
import { localDatabase } from "./local-store.js";
export async function backend(jar) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url && !key) return localClient(jar);
  if (!url || !key) throw new Error("Configuration Supabase incomplète");
  const db = await localDatabase();
  await db.exec(
    "create table if not exists local_meta.remote_sessions(token text primary key, session jsonb not null, expires_at timestamptz not null)",
  );
  const hash = (t) => createHash("sha256").update(t).digest("hex");
  let token = jar.get("esms_remote")?.value;
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  async function save(session) {
    if (!session) return;
    if (!token) token = randomBytes(32).toString("hex");
    await db.query(
      "insert into local_meta.remote_sessions values($1,$2,now()+interval '7 days') on conflict(token) do update set session=excluded.session,expires_at=excluded.expires_at",
      [hash(token), JSON.stringify(session)],
    );
    jar.set("esms_remote", token, { maxAge: 604800 });
  }
  if (token) {
    const r = await db.query(
      "select session from local_meta.remote_sessions where token=$1 and expires_at>now()",
      [hash(token)],
    );
    if (r.rows[0]) {
      const result = await client.auth.setSession(r.rows[0].session);
      if (!result.error) await save(result.data.session);
    }
  }
  for (const method of ["signInWithPassword", "signUp", "updateUser"]) {
    const original = client.auth[method].bind(client.auth);
    client.auth[method] = async (...args) => {
      const result = await original(...args);
      if (!result.error) {
        const s = await client.auth.getSession();
        await save(s.data.session);
      }
      return result;
    };
  }
  const signOut = client.auth.signOut.bind(client.auth);
  client.auth.signOut = async () => {
    const result = await signOut();
    if (token)
      await db.query("delete from local_meta.remote_sessions where token=$1", [
        hash(token),
      ]);
    jar.delete("esms_remote");
    return result;
  };
  return client;
}
