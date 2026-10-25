import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
test("HTTP auth, CSRF, role enforcement, private documents and restart persistence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "esms-http-"));
  const origin = "http://127.0.0.1:3107";
  let child,
    cookie = "";
  const env = {
    ...process.env,
    PORT: "3107",
    APP_ORIGIN: origin,
    ESMS_DATA_DIR: dir,
    SUPABASE_URL: "",
    SUPABASE_PUBLISHABLE_KEY: "",
  };
  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Startup timeout")),
        15000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("Server exit " + code));
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill();
      await done;
    }
  }
  async function call(route, body, expected = 200, originHeader = origin) {
    const response = await fetch(origin + "/api/" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        ...(body
          ? {
              Origin: originHeader,
              "X-ESMS-Request": "1",
              ...(body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
            }
          : {}),
      },
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await response.text();
    assert.equal(response.status, expected, route + ": " + text.slice(0, 200));
    return response.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : text;
  }
  const password = "Test-password-2026";
  try {
    await start();
    await call("state", null, 401);
    await call(
      "login",
      { username: "sample", password },
      403,
      "https://foreign.invalid",
    );
    const photo = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#002fa7" },
    })
      .png()
      .toBuffer();
    const f = new FormData();
    for (const [k, v] of Object.entries({
      username: "http.member",
      first_name: "Membre",
      last_name: "Test",
      department: "GI",
      academic_year: "2026-2027",
      password,
      confirmation: password,
    }))
      f.set(k, v);
    f.append("cells", "Event");
    f.set("photo", new File([photo], "profile.png", { type: "image/png" }));
    await call("register", f);
    const s = await call("state");
    assert.equal(s.profile.role, "member");
    assert.deepEqual(s.profile.cells, ["Event"]);
    await call("missions", { title: "Test" }, 403);
    await call(
      "member-access",
      { id: s.profile.id, role: "admin", active: true },
      403,
    );
    await call("logout", {});
    await call("state", null, 401);
    await call("login", { username: "http.member", password: "wrong" }, 401);
    await call("login", { username: "http.member", password });
    await stop();
    const promotion = spawn(
      process.execPath,
      ["scripts/local-admin.js", "promote", "http.member"],
      { env, stdio: "pipe" },
    );
    await new Promise((r, j) =>
      promotion.on("exit", (c) =>
        c === 0 ? r() : j(new Error("Promotion failed")),
      ),
    );
    await start();
    assert.equal((await call("state")).profile.role, "admin");
    await call("missions", {
      title: "Mission HTTP",
      description: "Validation",
      assignee_id: s.profile.id,
      due_date: "2026-11-01",
    });
    let updated = await call("state");
    assert.equal(updated.missions[0].due_date, "2026-11-01");
    await call("mission-status", {
      id: updated.missions[0].id,
      status: "done",
    });
    await call("meetings", {
      title: "Réunion HTTP",
      location: "ENSEM",
      starts_at: "2026-11-01T12:00:00.000Z",
      agenda: "Test",
    });
    updated = await call("state");
    await call("attendance", {
      meeting_id: updated.meetings[0].id,
      member_id: s.profile.id,
      status: "present",
    });
    const doc = new FormData();
    doc.set("title", "Document test");
    doc.set(
      "file",
      new File(["%PDF-1.4 test"], "test.pdf", { type: "application/pdf" }),
    );
    await call("documents", doc);
    updated = await call("state");
    assert.match(await call("documents/" + updated.documents[0].id), /%PDF/);
    await call("document-delete", { id: updated.documents[0].id });
    assert.equal((await call("state")).documents.length, 0);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
