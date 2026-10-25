import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
// Real PostgreSQL evaluates the exact migration. Only Supabase-owned auth/storage
// schemas are stubbed; HTTP Auth, Storage service and mail still need a live smoke test.
test("migration, RLS and security-definer RPCs enforce the role matrix", async (t) => {
  const db = new PGlite();
  await db.exec(`
 create role anon nologin; create role authenticated nologin;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public,storage to anon,authenticated;
 grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to authenticated;
 `);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610240001_esms.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const admin = "10000000-0000-4000-8000-000000000001",
    manager = "10000000-0000-4000-8000-000000000002",
    member = "10000000-0000-4000-8000-000000000003",
    other = "10000000-0000-4000-8000-000000000004";
  const mission = "20000000-0000-4000-8000-000000000001",
    meeting = "30000000-0000-4000-8000-000000000001",
    document = "40000000-0000-4000-8000-000000000001";
  await db.exec(
    `insert into auth.users(id,raw_user_meta_data) values ('${admin}','{"full_name":"Admin test","role":"admin"}'),('${manager}','{}'),('${member}','{"role":"admin"}'),('${other}','{}');`,
  );
  assert.equal(
    (await db.query(`select role from profiles where id='${member}'`)).rows[0]
      .role,
    "member",
    "metadata cannot grant admin",
  );
  await db.exec(
    `update profiles set role='admin' where id='${admin}';update profiles set role='manager' where id='${manager}';`,
  );
  async function as(who, sql) {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${who ?? ""}',false);set role ${who ? "authenticated" : "anon"};`,
    );
    return db.query(sql);
  }
  async function denied(who, sql) {
    await assert.rejects(() => as(who, sql));
  }
  try {
    await t.test("anonymous cannot read application data", async () => {
      await denied(null, "select * from profiles");
      await denied(null, "select * from documents");
    });
    await t.test("admin seeds mission, meeting and private file", async () => {
      await as(
        admin,
        `insert into missions(id,title,assignee_id,due_date) values('${mission}','Mission test','${member}','2026-11-01')`,
      );
      await as(
        admin,
        `insert into meetings(id,title,location,starts_at) values('${meeting}','Réunion test','Salle 1',now())`,
      );
      await as(
        admin,
        `insert into documents(id,title,object_path,original_name,mime_type,size_bytes) values('${document}','Document test','private/test','test.pdf','application/pdf',10)`,
      );
      await as(
        admin,
        `insert into storage.objects(bucket_id,name) values('private-documents','private/test')`,
      );
    });
    await t.test(
      "member sees own profile and mission, not peer data",
      async () => {
        assert.equal(
          (await as(member, "select * from profiles")).rows.length,
          1,
        );
        assert.equal(
          (await as(member, "select * from missions")).rows.length,
          1,
        );
        assert.equal(
          (await as(other, "select * from missions")).rows.length,
          0,
        );
        assert.equal(
          (await as(member, "select * from audit_log")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "self-promotion, deactivation and impersonation are rejected",
      async () => {
        await denied(
          member,
          `update profiles set role='admin' where id='${member}'`,
        );
        await denied(
          member,
          `update profiles set active=false where id='${member}'`,
        );
        await denied(
          member,
          `select set_member_access('${member}','admin',true)`,
        );
        await denied(
          manager,
          `select set_member_access('${other}','admin',true)`,
        );
        await denied(
          admin,
          `select set_member_access('${admin}','member',false)`,
        );
        await denied(
          manager,
          `insert into missions(title,assignee_id,due_date,created_by) values('Spoof test','${member}','2026-11-01','${admin}')`,
        );
      },
    );
    await t.test(
      "member edits own profile and own mission status only",
      async () => {
        await as(
          member,
          `update profiles set full_name='Membre test' where id='${member}'`,
        );
        await as(member, `select set_mission_status('${mission}','done')`);
        await denied(other, `select set_mission_status('${mission}','done')`);
        await as(
          member,
          `update missions set assignee_id='${other}',title='Hijacked' where id='${mission}'`,
        );
        const row = (
          await as(
            admin,
            `select title,assignee_id,status from missions where id='${mission}'`,
          )
        ).rows[0];
        assert.equal(row.title, "Mission test");
        assert.equal(row.assignee_id, member);
        assert.equal(row.status, "done");
        await denied(
          member,
          `insert into missions(title,assignee_id,due_date) values('New mission','${member}','2026-11-01')`,
        );
      },
    );
    await t.test(
      "responsible can mark attendance, member cannot forge it",
      async () => {
        await as(
          manager,
          `insert into attendances(meeting_id,member_id,status) values('${meeting}','${member}','present')`,
        );
        assert.equal(
          (await as(member, "select * from attendances")).rows.length,
          1,
        );
        assert.equal(
          (await as(other, "select * from attendances")).rows.length,
          0,
        );
        await denied(
          member,
          `insert into attendances(meeting_id,member_id,status) values('${meeting}','${other}','present')`,
        );
        await as(member, `update attendances set status='absent'`);
        assert.equal(
          (await as(manager, "select status from attendances")).rows[0].status,
          "present",
        );
      },
    );
    await t.test(
      "private metadata and objects need an individual grant, including manager",
      async () => {
        for (const who of [member, manager, other]) {
          assert.equal(
            (await as(who, "select * from documents")).rows.length,
            0,
          );
          assert.equal(
            (await as(who, "select * from storage.objects")).rows.length,
            0,
          );
        }
        await denied(
          member,
          `insert into document_grants(document_id,member_id) values('${document}','${member}')`,
        );
        await denied(
          manager,
          `insert into storage.objects(bucket_id,name) values('private-documents','forbidden')`,
        );
        await as(
          admin,
          `insert into document_grants(document_id,member_id) values('${document}','${member}')`,
        );
        assert.equal(
          (await as(member, "select * from documents")).rows.length,
          1,
        );
        assert.equal(
          (await as(member, "select * from storage.objects")).rows.length,
          1,
        );
        assert.equal(
          (await as(other, "select * from storage.objects")).rows.length,
          0,
        );
        await as(
          admin,
          `delete from document_grants where document_id='${document}' and member_id='${member}'`,
        );
        assert.equal(
          (await as(member, "select * from storage.objects")).rows.length,
          0,
        );
        assert.equal(
          (await as(member, "select * from documents")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "suspension invalidates database and storage rights with same JWT identity",
      async () => {
        await as(
          admin,
          `insert into document_grants(document_id,member_id) values('${document}','${member}')`,
        );
        await as(admin, `select set_member_access('${member}','member',false)`);
        for (const table of [
          "missions",
          "meetings",
          "attendances",
          "documents",
          "document_grants",
          "storage.objects",
        ])
          assert.equal(
            (await as(member, `select * from ${table}`)).rows.length,
            0,
            table,
          );
        await denied(member, `select set_mission_status('${mission}','todo')`);
        await as(
          member,
          `update profiles set full_name='Suspended edit' where id='${member}'`,
        );
        assert.equal(
          (
            await as(
              admin,
              `select full_name from profiles where id='${member}'`,
            )
          ).rows[0].full_name,
          "Membre test",
        );
      },
    );
    await t.test("audit is populated and cannot be forged", async () => {
      assert.ok((await as(admin, "select * from audit_log")).rows.length >= 8);
      await denied(
        admin,
        `insert into audit_log(action,entity) values('FAKE','profiles')`,
      );
      await denied(admin, "delete from audit_log");
    });
  } finally {
    await db.close();
  }
});
