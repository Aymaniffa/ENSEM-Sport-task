import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  localDatabase,
  registerLocal,
  authenticateLocal,
  newSession,
  sessionUser,
  revokeSession,
  updateLocalPassword,
  withIdentity,
} from "../../server/local-store.js";
test("local accounts preserve credentials, sessions, profiles and RLS", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "esms-accounts-"));
  process.env.ESMS_DATA_DIR = directory;
  const db = await localDatabase();
  try {
    const metadata = {
      username: "member.test",
      first_name: "Membre",
      last_name: "Test",
      full_name: "Membre Test",
      department: "GI",
      academic_year: "2026-2027",
      cells: ["Event", "Design"],
      role: "admin",
    };
    const user = await registerLocal(
      "member.test@members.esms.invalid",
      "Test-password-12345",
      metadata,
    );
    const profile = await db.query(
      "select role,cells,first_name from profiles where id=$1",
      [user.id],
    );
    assert.equal(profile.rows[0].role, "member");
    assert.deepEqual(profile.rows[0].cells, ["Event", "Design"]);
    assert.equal(profile.rows[0].first_name, "Membre");
    await assert.rejects(() =>
      registerLocal(
        "different@members.esms.invalid",
        "Test-password-12345",
        metadata,
      ),
    );
    const stored = await db.query(
      "select password_hash from auth.users where id=$1",
      [user.id],
    );
    assert.notEqual(stored.rows[0].password_hash, "Test-password-12345");
    assert.equal(
      (await authenticateLocal(user.email, "Test-password-12345")).id,
      user.id,
    );
    await assert.rejects(() => authenticateLocal(user.email, "wrong-password"));
    await assert.rejects(() =>
      authenticateLocal("unknown@members.esms.invalid", "wrong-password"),
    );
    const token = await newSession(user.id);
    assert.equal((await sessionUser(token))?.id, user.id);
    assert.equal(await sessionUser("forged"), null);
    const other = await registerLocal(
      "other.test@members.esms.invalid",
      "Test-password-98765",
      { ...metadata, username: "other.test" },
    );
    await withIdentity(user.id, (tx) =>
      tx.query(
        "insert into storage.objects(bucket_id,name,object_data,mime_type) values('profile-photos',$1,$2,'image/jpeg')",
        [user.id, new Uint8Array([255, 216, 255])],
      ),
    );
    assert.equal(
      (
        await withIdentity(other.id, (tx) =>
          tx.query("select * from storage.objects"),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await withIdentity(user.id, (tx) =>
          tx.query("select * from storage.objects"),
        )
      ).rows.length,
      1,
    );
    await assert.rejects(() =>
      withIdentity(other.id, (tx) =>
        tx.query(
          "insert into storage.objects(bucket_id,name,object_data,mime_type) values('profile-photos',$1,$2,'image/jpeg')",
          [user.id, new Uint8Array([1])],
        ),
      ),
    );
    await assert.rejects(() =>
      withIdentity(user.id, (tx) =>
        tx.query("update profiles set role='admin' where id=$1", [user.id]),
      ),
    );
    await db.query("update profiles set active=false where id=$1", [user.id]);
    assert.equal(await sessionUser(token), null);
    await db.query("update profiles set active=true where id=$1", [user.id]);
    await revokeSession(token);
    assert.equal(await sessionUser(token), null);
    const oldToken = await newSession(user.id);
    await updateLocalPassword(user.id, "Replacement-password-123");
    assert.equal(await sessionUser(oldToken), null);
    await assert.rejects(() =>
      authenticateLocal(user.email, "Test-password-12345"),
    );
    assert.equal(
      (await authenticateLocal(user.email, "Replacement-password-123")).id,
      user.id,
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
