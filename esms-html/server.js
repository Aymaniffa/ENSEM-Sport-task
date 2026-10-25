import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { backend } from "./server/backend.js";
import {
  registrationSchema,
  memberDetailsSchema,
  usernameSchema,
  accountEmail,
} from "./server/registration.js";
import {
  missionSchema,
  meetingSchema,
  id,
  roles,
  statuses,
  attendanceStatuses,
  validFile,
  isStaff,
} from "./server/validation.js";
import { normalizePhoto } from "./server/photo.js";
import { allRows } from "./server/pagination.js";
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
const origin = process.env.APP_ORIGIN || `http://${host}:${port}`;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function check(result) {
  if (result.error) throw fail("Opération refusée ou données invalides.");
  return result.data;
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  const send = (data, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  };
  try {
    const url = new URL(req.url, origin),
      path = url.pathname;
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET") throw fail("Méthode refusée", 405);
      const asset = {
        "/app.js": ["app.js", "text/javascript"],
        "/styles.css": ["styles.css", "text/css"],
        "/ensem-sport-logo.png": ["ensem-sport-logo.png", "image/png"],
      }[path];
      if (
        !asset &&
        ![
          "/",
          "/login",
          "/register",
          "/dashboard",
          "/profile",
          "/missions",
          "/meetings",
          "/documents",
          "/admin",
          "/setup",
        ].includes(path)
      )
        throw fail("Page introuvable", 404);
      res.setHeader(
        "Content-Type",
        (asset?.[1] || "text/html") + "; charset=utf-8",
      );
      res.end(
        await readFile(
          new URL("./public/" + (asset?.[0] || "index.html"), import.meta.url),
        ),
      );
      return;
    }
    if (!["GET", "POST"].includes(req.method))
      throw fail("Méthode refusée", 405);
    if (
      req.method === "POST" &&
      (req.headers.origin !== origin || req.headers["x-esms-request"] !== "1")
    )
      throw fail("Origine refusée", 403);
    const values = new Map(
      (req.headers.cookie || "").split(";").map((s) => s.trim().split("=")),
    );
    const setCookie = (name, value, maxAge) => {
      const list = res.getHeader("Set-Cookie") || [];
      res.setHeader("Set-Cookie", [
        ...list,
        `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
      ]);
      values.set(name, value);
    };
    const db = await backend({
      get: (n) => (values.has(n) ? { value: values.get(n) } : undefined),
      set: (n, v, o) => setCookie(n, v, o.maxAge || 604800),
      delete: (n) => setCookie(n, "", 0),
    });
    let f = null,
      b = {};
    if (req.method === "POST") {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 12 * 1024 * 1024)
          throw fail("Fichier trop volumineux", 413);
        chunks.push(chunk);
      }
      const request = new Request(origin, {
        method: "POST",
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
        },
        body: Buffer.concat(chunks),
      });
      if (
        (req.headers["content-type"] || "").startsWith("multipart/form-data")
      ) {
        f = await request.formData();
        b = Object.fromEntries(f);
        b.cells = f.getAll("cells");
      } else b = await request.json();
    }
    if (path === "/api/register" && req.method === "POST") {
      const details = registrationSchema.parse(b);
      if (!f?.get("photo")) throw fail("Photo obligatoire");
      const photo = await normalizePhoto(f.get("photo"));
      const { password, confirmation, ...metadata } = details;
      metadata.full_name = `${details.first_name} ${details.last_name}`.slice(
        0,
        100,
      );
      const result = await db.auth.signUp({
        email: accountEmail(details.username),
        password,
        options: { data: metadata },
      });
      if (result.error)
        throw fail(
          "Inscription impossible. Ce nom est peut-être déjà utilisé.",
        );
      if (!result.data.session)
        throw fail(
          "Compte créé. La confirmation des inscriptions doit être configurée par l’administrateur.",
        );
      const upload = await db.storage
        .from("profile-photos")
        .upload(result.data.user.id, photo, {
          contentType: "image/jpeg",
          upsert: true,
        });
      send({
        ok: true,
        warning: upload.error
          ? "Compte créé ; ajoutez votre photo depuis le profil."
          : null,
      });
      return;
    }
    if (path === "/api/login" && req.method === "POST") {
      const username = usernameSchema.parse(b.username);
      if (typeof b.password !== "string" || b.password.length > 128)
        throw fail("Identifiants invalides");
      const r = await db.auth.signInWithPassword({
        email: accountEmail(username),
        password: b.password,
      });
      if (r.error)
        throw fail("Identifiants invalides ou compte indisponible.", 401);
      send({ ok: true });
      return;
    }
    if (path === "/api/logout" && req.method === "POST") {
      check(await db.auth.signOut());
      send({ ok: true });
      return;
    }
    const auth = await db.auth.getUser();
    if (!auth.data.user) throw fail("Connectez-vous pour continuer.", 401);
    const user = auth.data.user;
    const profile = check(
      await db.from("profiles").select("*").eq("id", user.id).single(),
    );
    if (!profile?.active) throw fail("Compte désactivé", 403);
    const staff = () => {
      if (!isStaff(profile.role))
        throw fail("Accès réservé aux responsables", 403);
    };
    const admin = () => {
      if (profile.role !== "admin")
        throw fail("Accès réservé à l’administrateur", 403);
    };
    if (req.method === "GET") {
      if (path === "/api/state") {
        const result = { profile };
        for (const table of [
          "profiles",
          "missions",
          "meetings",
          "attendances",
          "documents",
          "document_grants",
          ...(profile.role === "admin" ? ["audit_log"] : []),
        ])
          result[table] = check(
            await allRows((from, to) =>
              db
                .from(table)
                .select("*")
                .order(
                  table === "attendances"
                    ? "meeting_id"
                    : table === "document_grants"
                      ? "document_id"
                      : "id",
                )
                .range(from, to),
            ),
          );
        send(result);
        return;
      }
      const photo = path.match(/^\/api\/photos\/([^/]+)$/),
        doc = path.match(/^\/api\/documents\/([^/]+)$/);
      if (photo || doc) {
        let name, bucket, type, filename;
        if (photo) {
          name = id.parse(photo[1]);
          bucket = "profile-photos";
          type = "image/jpeg";
        } else {
          const row = check(
            await db
              .from("documents")
              .select("*")
              .eq("id", id.parse(doc[1]))
              .single(),
          );
          if (!row) throw fail("Document introuvable", 404);
          name = row.object_path;
          bucket = "private-documents";
          type = "application/octet-stream";
          filename = row.original_name;
        }
        const file = check(await db.storage.from(bucket).download(name));
        res.setHeader("Content-Type", type);
        if (filename)
          res.setHeader(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, "%27")}`,
          );
        res.end(Buffer.from(await file.arrayBuffer()));
        return;
      }
      throw fail("Introuvable", 404);
    }
    switch (path) {
      case "/api/profile": {
        const d = memberDetailsSchema.parse(b);
        if (typeof b.bio !== "string" || b.bio.length > 1000)
          throw fail("Biographie invalide");
        check(
          await db
            .from("profiles")
            .update({
              ...d,
              full_name: `${d.first_name} ${d.last_name}`.slice(0, 100),
              bio: b.bio,
            })
            .eq("id", user.id),
        );
        if (f?.get("photo")?.size)
          check(
            await db.storage
              .from("profile-photos")
              .upload(user.id, await normalizePhoto(f.get("photo")), {
                contentType: "image/jpeg",
                upsert: true,
              }),
          );
        break;
      }
      case "/api/password":
        if (
          typeof b.password !== "string" ||
          b.password.length < 12 ||
          b.password.length > 128 ||
          b.password !== b.confirmation
        )
          throw fail(
            "Mot de passe : 12 à 128 caractères et confirmation identique.",
          );
        check(await db.auth.updateUser({ password: b.password }));
        break;
      case "/api/missions":
        staff();
        check(await db.from("missions").insert(missionSchema.parse(b)));
        break;
      case "/api/mission-status":
        if (!statuses.includes(b.status)) throw fail("Statut invalide");
        check(
          await db.rpc("set_mission_status", {
            target: id.parse(b.id),
            new_status: b.status,
          }),
        );
        break;
      case "/api/mission-delete":
        staff();
        check(await db.from("missions").delete().eq("id", id.parse(b.id)));
        break;
      case "/api/meetings":
        staff();
        check(await db.from("meetings").insert(meetingSchema.parse(b)));
        break;
      case "/api/meeting-delete":
        staff();
        check(await db.from("meetings").delete().eq("id", id.parse(b.id)));
        break;
      case "/api/attendance":
        staff();
        if (!attendanceStatuses.includes(b.status))
          throw fail("Statut invalide");
        check(
          await db.from("attendances").upsert({
            meeting_id: id.parse(b.meeting_id),
            member_id: id.parse(b.member_id),
            status: b.status,
            marked_by: user.id,
            updated_at: new Date().toISOString(),
          }),
        );
        break;
      case "/api/member-access":
        admin();
        if (!roles.includes(b.role) || typeof b.active !== "boolean")
          throw fail("Accès invalide");
        check(
          await db.rpc("set_member_access", {
            target: id.parse(b.id),
            new_role: b.role,
            enabled: b.active,
          }),
        );
        break;
      case "/api/documents": {
        admin();
        const file = f?.get("file");
        if (
          !file ||
          !validFile(file.size, file.type) ||
          typeof b.title !== "string" ||
          b.title.trim().length < 2 ||
          b.title.length > 160
        )
          throw fail(
            "Titre et fichier PDF, JPG, PNG, DOCX ou XLSX (10 Mo maximum) requis.",
          );
        const docId = randomUUID(),
          objectPath = `${docId}/${randomUUID()}`;
        check(
          await db.storage
            .from("private-documents")
            .upload(objectPath, file, { contentType: file.type }),
        );
        const r = await db.from("documents").insert({
          id: docId,
          title: b.title.trim(),
          object_path: objectPath,
          original_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        });
        if (r.error) {
          await db.storage.from("private-documents").remove([objectPath]);
          check(r);
        }
        break;
      }
      case "/api/grant":
        admin();
        check(
          await db.from("document_grants").upsert(
            {
              document_id: id.parse(b.document_id),
              member_id: id.parse(b.member_id),
            },
            { onConflict: "document_id,member_id", ignoreDuplicates: true },
          ),
        );
        break;
      case "/api/revoke":
        admin();
        check(
          await db
            .from("document_grants")
            .delete()
            .eq("document_id", id.parse(b.document_id))
            .eq("member_id", id.parse(b.member_id)),
        );
        break;
      case "/api/document-delete": {
        admin();
        const row = check(
          await db
            .from("documents")
            .select("*")
            .eq("id", id.parse(b.id))
            .single(),
        );
        if (!row) throw fail("Introuvable", 404);
        check(
          await db.storage.from("private-documents").remove([row.object_path]),
        );
        check(await db.from("documents").delete().eq("id", row.id));
        break;
      }
      default:
        throw fail("Introuvable", 404);
    }
    send({ ok: true });
  } catch (e) {
    const status = e.status || (e.name === "ZodError" ? 400 : 500);
    send(
      {
        error:
          status === 500
            ? "Erreur serveur. Réessayez."
            : e.name === "ZodError"
              ? e.issues[0].message
              : e.message,
      },
      status,
    );
    if (status === 500) console.error(e.message);
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, host, () =>
  console.log(`ESMS HTML / CSS / JavaScript : ${origin}`),
);
