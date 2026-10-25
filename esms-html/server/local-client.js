import {
  authenticateLocal,
  registerLocal,
  newSession,
  sessionUser,
  revokeSession,
  updateLocalPassword,
  withIdentity,
} from "./local-store.js";
import { fileTypes } from "./validation.js";
const tables = new Set([
  "profiles",
  "missions",
  "meetings",
  "attendances",
  "documents",
  "document_grants",
  "audit_log",
]);
function identifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("Invalid SQL identifier");
  return `"${value}"`;
}
const failure = (e) => ({
  data: null,
  error: { message: e instanceof Error ? e.message : "Opération impossible" },
  count: null,
});
class Query {
  table;
  userId;
  operation = "select";
  payload = {};
  columns = "*";
  filters = [];
  orders = [];
  fromIndex = 0;
  maximum;
  one = false;
  options = {};
  constructor(table, userId) {
    this.table = table;
    this.userId = userId;
    if (!tables.has(table)) throw new Error("Unknown table");
  }
  select(columns = "*", options = {}) {
    this.columns = columns;
    this.options = options;
    return this;
  }
  insert(data) {
    this.operation = "insert";
    this.payload = data;
    return this;
  }
  update(data) {
    this.operation = "update";
    this.payload = data;
    return this;
  }
  upsert(data, options = {}) {
    this.operation = "upsert";
    this.payload = data;
    this.options = options;
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  eq(column, value) {
    this.filters.push({ column, operator: "=", value });
    return this;
  }
  gte(column, value) {
    this.filters.push({ column, operator: ">=", value });
    return this;
  }
  order(column, options = {}) {
    this.orders.push(
      `${identifier(column)} ${options.ascending === false ? "desc" : "asc"}`,
    );
    return this;
  }
  limit(value) {
    this.maximum = value;
    return this;
  }
  range(from, to) {
    this.fromIndex = from;
    this.maximum = to - from + 1;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  async execute() {
    try {
      const params = [];
      const param = (v) => {
        params.push(v);
        return `$${params.length}`;
      };
      const table = `public.${identifier(this.table)}`;
      let sql = "";
      const keys = Object.keys(this.payload);
      if (this.operation === "select")
        sql = `select ${this.columns === "*" ? "*" : this.columns.split(",").map(identifier).join(",")} from ${table}`;
      if (this.operation === "delete") sql = `delete from ${table}`;
      if (this.operation === "update")
        sql = `update ${table} set ${keys.map((k) => `${identifier(k)}=${param(this.payload[k])}`).join(",")}`;
      if (this.operation === "insert" || this.operation === "upsert") {
        sql = `insert into ${table} (${keys.map(identifier).join(",")}) values (${keys.map((k) => param(this.payload[k])).join(",")})`;
        if (this.operation === "upsert") {
          const conflict =
            this.options.onConflict ??
            (this.table === "attendances" ? "meeting_id,member_id" : "id");
          sql += ` on conflict (${conflict.split(",").map(identifier).join(",")}) do `;
          sql += this.options.ignoreDuplicates
            ? "nothing"
            : `update set ${keys.map((k) => `${identifier(k)}=excluded.${identifier(k)}`).join(",")}`;
        }
      } else if (this.filters.length)
        sql += ` where ${this.filters.map((f) => `${identifier(f.column)} ${f.operator} ${param(f.value)}`).join(" and ")}`;
      if (this.operation === "select") {
        if (this.orders.length) sql += ` order by ${this.orders.join(",")}`;
        if (this.maximum !== undefined)
          sql += ` limit ${param(this.maximum)} offset ${param(this.fromIndex)}`;
      }
      const result = await withIdentity(this.userId, (tx) =>
        tx.query(sql, params),
      );
      // PGlite returns Date objects; match PostgREST's ISO strings, including
      // PostgreSQL date-only values used by mission deadlines.
      const rows = result.rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value instanceof Date
              ? key === "due_date"
                ? value.toISOString().slice(0, 10)
                : value.toISOString()
              : value,
          ]),
        ),
      );
      if (this.one && result.rows.length !== 1)
        throw new Error("Enregistrement introuvable.");
      return {
        data: this.options.head ? null : this.one ? rows[0] : rows,
        error: null,
        count: this.options.count ? result.rows.length : null,
      };
    } catch (e) {
      return failure(e);
    }
  }
  then(onfulfilled, onrejected) {
    return this.execute().then(onfulfilled, onrejected);
  }
}
export async function localClient(jar) {
  const cookieName = "esms_session";
  let user = await sessionUser(jar.get(cookieName)?.value);
  async function attach(id) {
    jar.set(cookieName, await newSession(id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ESMS_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
  }
  const client = {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      },
      async signInWithPassword({ email, password }) {
        try {
          user = await authenticateLocal(email, password);
          await attach(user.id);
          return { data: { user }, error: null };
        } catch (e) {
          return failure(e);
        }
      },
      async signUp({ email, password, options }) {
        try {
          user = await registerLocal(email, password, options.data);
          await attach(user.id);
          return { data: { user, session: { local: true } }, error: null };
        } catch (e) {
          return failure(e);
        }
      },
      async signOut() {
        await revokeSession(jar.get(cookieName)?.value);
        jar.delete(cookieName);
        user = null;
        return { error: null };
      },
      async updateUser({ password }) {
        try {
          if (!user) throw new Error("Non connecté");
          await updateLocalPassword(user.id, password);
          await attach(user.id);
          return { data: { user }, error: null };
        } catch (e) {
          return failure(e);
        }
      },
    },
    from(table) {
      return new Query(table, user?.id ?? null);
    },
    async rpc(name, args) {
      try {
        const functions = {
          set_mission_status: ["target", "new_status"],
          set_member_access: ["target", "new_role", "enabled"],
        };
        if (!functions[name]) throw new Error("Unknown function");
        await withIdentity(user?.id ?? null, (tx) =>
          tx.query(
            `select public.${identifier(name)}(${functions[name].map((_, i) => `$${i + 1}`).join(",")})`,
            functions[name].map((k) => args[k]),
          ),
        );
        return { data: null, error: null };
      } catch (e) {
        return failure(e);
      }
    },
    storage: {
      from(bucket) {
        return {
          async upload(name, file, options = {}) {
            try {
              const bytes = Buffer.isBuffer(file)
                ? file
                : Buffer.from(await file.arrayBuffer());
              const mime =
                options.contentType ??
                (file instanceof Blob ? file.type : "application/octet-stream");
              if (
                !(
                  bucket === "profile-photos" ? ["image/jpeg"] : fileTypes
                ).includes(mime)
              )
                throw new Error("Type de fichier refusé");
              const max =
                bucket === "profile-photos"
                  ? 2 * 1024 * 1024
                  : 10 * 1024 * 1024;
              if (bytes.length === 0 || bytes.length > max)
                throw new Error("Taille du fichier invalide");
              await withIdentity(user?.id ?? null, (tx) =>
                tx.query(
                  `insert into storage.objects(bucket_id,name,object_data,mime_type) values($1,$2,$3,$4) ${options.upsert ? "on conflict(bucket_id,name) do update set object_data=excluded.object_data,mime_type=excluded.mime_type" : ""}`,
                  [bucket, name, bytes, mime],
                ),
              );
              return { data: { path: name }, error: null };
            } catch (e) {
              return failure(e);
            }
          },
          async download(name) {
            try {
              const result = await withIdentity(user?.id ?? null, (tx) =>
                tx.query(
                  "select object_data,mime_type from storage.objects where bucket_id=$1 and name=$2",
                  [bucket, name],
                ),
              );
              if (!result.rows[0]) throw new Error("Fichier introuvable");
              return {
                data: new Blob([new Uint8Array(result.rows[0].object_data)], {
                  type: result.rows[0].mime_type,
                }),
                error: null,
              };
            } catch (e) {
              return failure(e);
            }
          },
          async remove(names) {
            try {
              await withIdentity(user?.id ?? null, (tx) =>
                tx.query(
                  "delete from storage.objects where bucket_id=$1 and name=any($2::text[])",
                  [bucket, names],
                ),
              );
              return { data: [], error: null };
            } catch (e) {
              return failure(e);
            }
          },
        };
      },
    },
  };
  // The adapter implements only the methods used in ESMS. The production schema
  // contract remains shared with Supabase; local mutations still execute RLS.
  return client;
}
