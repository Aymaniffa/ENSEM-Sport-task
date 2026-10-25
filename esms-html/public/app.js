const app = document.querySelector("#app");
const cells = [
  "Event",
  "Sponsoring",
  "Communication",
  "Média",
  "Design",
  "Soirée et Show",
  "Logistique",
  "Jeux et Sport",
];
const labels = {
  member: "Membre",
  manager: "Responsable",
  admin: "Administrateur",
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminée",
  present: "Présent",
  absent: "Absent",
  excused: "Excusé",
};
let state,
  notice = "";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const input = (name, label, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const select = (name, label, options, value) =>
  `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${e(v)}" ${v === value ? "selected" : ""}>${e(t)}</option>`).join("")}</select></label>`;
const hidden = (name, value) =>
  `<input type="hidden" name="${name}" value="${e(value)}">`;
const button = (text = "Enregistrer") =>
  `<button class="button" type="submit">${text}</button>`;
const form = (action, content, cls = "stack") =>
  `<form data-action="${action}" class="${cls}">${content}<p class="form-error" role="alert"></p></form>`;
const empty = () => '<p class="empty">Aucun élément pour le moment.</p>';
const person = (id) =>
  state.profiles.find((p) => p.id === id)?.full_name || "Membre";
const options = () =>
  state.profiles.filter((p) => p.active).map((p) => [p.id, p.full_name]);
const staff = () => ["admin", "manager"].includes(state.profile.role);
const admin = () => state.profile.role === "admin";
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("fr-MA", {
        dateStyle: "medium",
        ...(v.includes("T") ? { timeStyle: "short" } : {}),
      }).format(new Date(v))
    : "—";
function details(p = {}, requiredPhoto = false) {
  return `${input("first_name", "Prénom", p.first_name, "text", 'required maxlength="50"')}${input("last_name", "Nom", p.last_name, "text", 'required maxlength="50"')}${input("department", "Filière", p.department, "text", 'required maxlength="100"')}${input("academic_year", "Année universitaire", p.academic_year || "2026-2027", "text", 'required pattern="20[0-9]{2}-20[0-9]{2}" placeholder="2026-2027"')}<fieldset class="wide cell-picker"><legend>Vos cellules</legend><p class="cell-help">Sélectionnez les cellules que vous avez rejointes.</p>${cells.map((c) => `<label><input type="checkbox" name="cells" value="${e(c)}" ${(p.cells || []).includes(c) ? "checked" : ""}> ${e(c)}</label>`).join("")}</fieldset><label class="wide">Photo de profil <small class="field-hint">JPG, PNG ou WebP · 2 Mo maximum</small><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" ${requiredPhoto ? "required" : ""}></label>`;
}
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "X-ESMS-Request": "1",
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        }
      : {},
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
  return data;
}
function authPage() {
  const register = location.pathname === "/register";
  app.innerHTML = `<main class="auth-page"><section class="auth-brand"><a class="wordmark" href="/login"><img class="club-logo" src="/ensem-sport-logo.png" alt="Écusson ENSEM Sport"><span class="brand-name">ENSEM <b>SPORT</b><small>Espace membres · ESMS</small></span></a><div><p class="eyebrow">ENSEM · Casablanca</p><h1>ENSEMBLE.<br><span>PLUS LOIN.</span></h1><p>Votre espace pour organiser les missions, préparer les événements et avancer ensemble.</p></div><div class="brand-bottom"><span>Sport. Engagement. Esprit d’équipe.</span><span class="brand-rule" aria-hidden="true"></span></div></section><section class="auth-card"><nav class="auth-tabs"><a href="/login" ${!register ? 'aria-current="page"' : ""}>Se connecter</a><a href="/register" ${register ? 'aria-current="page"' : ""}>S’inscrire</a></nav><p class="form-kicker">${register ? "DEVENEZ MEMBRE" : "VOTRE ESPACE CLUB"}</p><h2>${register ? "À vous de jouer." : "De retour dans l’équipe."}</h2><p>${register ? "Créez votre compte membre et sélectionnez vos cellules." : "Connectez-vous avec votre nom d’utilisateur et votre mot de passe."}</p>${notice ? `<p class="notice">${e(notice)}</p>` : ""}${form(register ? "register" : "login", `${input("username", "Nom d’utilisateur", "", "text", 'required minlength="3" maxlength="30" autocomplete="username" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}"')}${register ? details({}, true) : ""}${input("password", "Mot de passe", "", "password", `required ${register ? 'minlength="12"' : ""} maxlength="128" autocomplete="${register ? "new" : "current"}-password"`)}${register ? input("confirmation", "Confirmer le mot de passe", "", "password", 'required minlength="12" autocomplete="new-password"') : ""}<div class="wide">${button(register ? "Créer mon compte" : "Se connecter")}</div>`, register ? "form-grid registration-form" : "stack")}</section></main>`;
}
function dashboard() {
  return `<div class="metrics">${[
    ["Missions", state.missions.length],
    ["Terminées", state.missions.filter((m) => m.status === "done").length],
    ["Réunions", state.meetings.length],
    ["Documents accessibles", state.documents.length],
  ]
    .map(
      ([t, n]) =>
        `<section class="panel"><p>${t}</p><strong class="metric-value">${n}</strong></section>`,
    )
    .join("")}</div><section class="panel"><h2>Mes prochaines missions</h2>${
    state.missions
      .filter((m) => m.assignee_id === state.profile.id && m.status !== "done")
      .map(
        (m) =>
          `<div class="list-row"><a href="/missions">${e(m.title)}</a><span>${e(date(m.due_date))}</span></div>`,
      )
      .join("") || empty()
  }</section><section class="panel"><h2>Réunions à venir</h2>${
    state.meetings
      .filter((m) => new Date(m.starts_at) > new Date())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(
        (m) =>
          `<div class="list-row"><a href="/meetings">${e(m.title)}</a><span>${e(date(m.starts_at))}</span></div>`,
      )
      .join("") || empty()
  }</section>`;
}
function profilePage() {
  const p = state.profile;
  return `<section class="panel"><img class="profile-photo" src="/api/photos/${e(p.id)}" alt="Photo de profil" width="100" height="100"><h2>${e(p.full_name)}</h2><p>${e(labels[p.role])} · ${e(p.username)}</p>${form("profile", details(p) + `<label class="wide">Biographie<textarea name="bio" maxlength="1000">${e(p.bio)}</textarea></label><div class="wide">${button()}</div>`, "form-grid")}</section><section class="panel"><h2>Changer le mot de passe</h2>${form("password", input("password", "Nouveau mot de passe", "", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"') + input("confirmation", "Confirmation", "", "password", 'required autocomplete="new-password"') + button())}</section>`;
}
function missions() {
  return `${staff() ? `<section class="panel"><h2>Créer une mission</h2>${form("missions", input("title", "Titre", "", "text", 'required minlength="3" maxlength="160"') + '<label>Description<textarea name="description" maxlength="5000"></textarea></label>' + select("assignee_id", "Membre", options()) + input("due_date", "Échéance", "", "date", "required") + button("Créer"))}</section>` : ""}<section class="panel"><h2>Missions</h2>${
    state.missions
      .map(
        (m) =>
          `<article class="record"><h3>${e(m.title)}</h3><p>${e(m.description)}</p><p>${e(person(m.assignee_id))} · ${e(date(m.due_date))}</p>${form(
            "mission-status",
            hidden("id", m.id) +
              select(
                "status",
                "Statut",
                ["todo", "in_progress", "done"].map((v) => [v, labels[v]]),
                m.status,
              ) +
              button(),
          )}${staff() ? form("mission-delete", hidden("id", m.id) + button("Supprimer")) : ""}</article>`,
      )
      .join("") || empty()
  }</section>`;
}
function meetings() {
  return `${staff() ? `<section class="panel"><h2>Planifier une réunion</h2>${form("meetings", input("title", "Titre", "", "text", 'required minlength="3" maxlength="160"') + input("location", "Lieu", "", "text", 'required minlength="2" maxlength="200"') + input("starts_at", "Date et heure", "", "datetime-local", "required") + '<label>Ordre du jour<textarea name="agenda" maxlength="5000"></textarea></label>' + button("Planifier"))}</section>` : ""}<section class="panel"><h2>Réunions et présences</h2>${
    state.meetings
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
      .map(
        (m) =>
          `<article class="record"><h3>${e(m.title)}</h3><p>${e(date(m.starts_at))} · ${e(m.location)}</p><p>${e(m.agenda)}</p>${state.attendances
            .filter((a) => a.meeting_id === m.id)
            .map(
              (a) =>
                `<p>${e(person(a.member_id))} : ${e(labels[a.status])}</p>`,
            )
            .join("")}${
            staff()
              ? form(
                  "attendance",
                  hidden("meeting_id", m.id) +
                    select("member_id", "Membre", options()) +
                    select(
                      "status",
                      "Présence",
                      ["present", "absent", "excused"].map((v) => [
                        v,
                        labels[v],
                      ]),
                    ) +
                    button("Enregistrer la présence"),
                ) +
                form(
                  "meeting-delete",
                  hidden("id", m.id) + button("Supprimer la réunion"),
                )
              : ""
          }</article>`,
      )
      .join("") || empty()
  }</section>`;
}
function documents() {
  return `${admin() ? `<section class="panel"><h2>Ajouter un document privé</h2>${form("documents", input("title", "Titre", "", "text", 'required minlength="2" maxlength="160"') + input("file", "Fichier · 10 Mo maximum", "", "file", 'required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"') + button("Importer"))}</section>` : ""}<section class="panel"><h2>Documents accessibles</h2>${
    state.documents
      .map(
        (d) =>
          `<article class="record"><h3>${e(d.title)}</h3><a class="button secondary" href="/api/documents/${e(d.id)}">Télécharger ${e(d.original_name)}</a>${
            admin()
              ? `<h4>Accès individuels</h4>${state.document_grants
                  .filter((g) => g.document_id === d.id)
                  .map((g) =>
                    form(
                      "revoke",
                      hidden("document_id", d.id) +
                        hidden("member_id", g.member_id) +
                        `<span>${e(person(g.member_id))}</span>` +
                        button("Retirer l’accès"),
                    ),
                  )
                  .join(
                    "",
                  )}${form("grant", hidden("document_id", d.id) + select("member_id", "Autoriser un membre", options()) + button("Accorder l’accès"))}${form("document-delete", hidden("id", d.id) + button("Supprimer le document"))}`
              : ""
          }</article>`,
      )
      .join("") || empty()
  }</section>`;
}
function administration() {
  if (!admin()) return empty();
  return `<section class="panel"><h2>Membres et rôles</h2>${state.profiles
    .map(
      (p) =>
        `<article class="record"><h3>${e(p.full_name)}</h3><p>${e(p.department)} · ${e(p.academic_year)} · ${e((p.cells || []).join(", "))}</p>${
          p.id !== state.profile.id
            ? form(
                "member-access",
                hidden("id", p.id) +
                  select(
                    "role",
                    "Rôle",
                    ["member", "manager", "admin"].map((r) => [r, labels[r]]),
                    p.role,
                  ) +
                  select(
                    "active",
                    "Compte",
                    [
                      ["true", "Actif"],
                      ["false", "Désactivé"],
                    ],
                    String(p.active),
                  ) +
                  button(),
              )
            : "<p>Votre compte administrateur</p>"
        }</article>`,
    )
    .join("")}</section><section class="panel"><h2>Journal d’activité</h2>${
    (state.audit_log || [])
      .slice()
      .reverse()
      .slice(0, 100)
      .map(
        (a) =>
          `<div class="list-row"><span>${e(a.action)} · ${e(a.entity)}</span><span>${e(date(a.created_at))}</span></div>`,
      )
      .join("") || empty()
  }</section>`;
}
async function render() {
  if (["/login", "/register", "/", "/setup"].includes(location.pathname)) {
    authPage();
    return;
  }
  try {
    state = await api("state");
    const pages = {
      "/dashboard": ["Tableau de bord", dashboard],
      "/profile": ["Mon profil", profilePage],
      "/missions": ["Missions", missions],
      "/meetings": ["Réunions", meetings],
      "/documents": ["Documents privés", documents],
      "/admin": ["Administration", administration],
    };
    const [title, view] = pages[location.pathname] || pages["/dashboard"];
    app.innerHTML = `<div class="workspace"><aside class="sidebar"><a class="wordmark" href="/dashboard"><img class="club-logo" src="/ensem-sport-logo.png" alt="Écusson ENSEM Sport"><span class="brand-name">ENSEM <b>SPORT</b><small>Espace membres · ESMS</small></span></a><nav>${Object.entries(
      pages,
    )
      .filter(([p]) => p !== "/admin" || admin())
      .map(
        ([p, [t]]) =>
          `<a href="${p}" ${p === location.pathname ? 'aria-current="page"' : ""}>${t}</a>`,
      )
      .join(
        "",
      )}</nav><div class="account"><p>${e(state.profile.full_name)}</p><small>${e(labels[state.profile.role])}</small>${form("logout", button("Se déconnecter"))}</div></aside><div class="main-shell"><header class="topbar">ENSEM Sport Management System</header><main id="main"><div class="page-heading"><p class="eyebrow">Espace ENSEM Sport</p><h1>${title}</h1></div>${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ""}${view()}</main></div></div>`;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      history.replaceState({}, "", "/login");
      notice = err.message;
      authPage();
    } else
      app.innerHTML = `<main class="panel"><p role="alert">${e(err.message)}</p><a href="/dashboard">Réessayer</a></main>`;
  }
}
app.addEventListener("submit", async (event) => {
  const target = event.target;
  if (!target.matches("form[data-action]")) return;
  event.preventDefault();
  const action = target.dataset.action;
  if (
    (action.endsWith("-delete") || action === "revoke") &&
    !confirm("Confirmer cette action ?")
  )
    return;
  const submit = target.querySelector("button");
  submit.disabled = true;
  const error = target.querySelector(".form-error");
  error.textContent = "";
  try {
    const data = new FormData(target);
    let body = ["register", "profile", "documents"].includes(action)
      ? data
      : Object.fromEntries(data);
    if (action === "meetings")
      body.starts_at = new Date(body.starts_at).toISOString();
    if (action === "member-access") body.active = body.active === "true";
    const result = await api(action, body);
    notice =
      result.warning ||
      (["login", "logout"].includes(action) ? "" : "Enregistrement effectué.");
    if (["login", "register"].includes(action))
      history.pushState({}, "", "/dashboard");
    if (action === "logout") history.pushState({}, "", "/login");
    await render();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});
app.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (
    !link ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    link.pathname.startsWith("/api/")
  )
    return;
  if (link.origin === location.origin) {
    event.preventDefault();
    notice = "";
    history.pushState({}, "", link.pathname);
    render();
  }
});
window.addEventListener("popstate", () => {
  notice = "";
  render();
});
render();
