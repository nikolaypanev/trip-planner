const CATEGORIES = { see: "To see", do: "To do", eat: "To eat", stay: "To stay", other: "Other" };
const app = document.getElementById("app");

// Builds DOM nodes. Text always goes in as text nodes, never as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || (k in el && typeof v !== "string")) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fmtDates(t) {
  const opts = { day: "numeric", month: "short", year: "numeric" };
  const f = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, opts);
  if (t.start_date && t.end_date) return `${f(t.start_date)} – ${f(t.end_date)}`;
  if (t.start_date) return `From ${f(t.start_date)}`;
  return "No dates yet";
}

function showError(err) {
  app.replaceChildren(h("p", { class: "error" }, err.message), h("a", { href: "#/" }, "Back to trips"));
}

function tripForm(trip = {}, onSubmit, submitLabel) {
  const err = h("p", { class: "error" });
  const form = h(
    "form",
    {
      class: "stack card",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await onSubmit(formData(form));
        } catch (x) {
          err.textContent = x.message;
        }
      },
    },
    h("label", {}, "Name", h("input", { name: "name", required: true, value: trip.name || "", placeholder: "Summer in Portugal" })),
    h("label", {}, "Destination", h("input", { name: "destination", value: trip.destination || "", placeholder: "Lisbon, Porto" })),
    h(
      "div",
      { class: "grid2" },
      h("label", {}, "Start date", h("input", { name: "start_date", type: "date", value: trip.start_date || "" })),
      h("label", {}, "End date", h("input", { name: "end_date", type: "date", value: trip.end_date || "" })),
    ),
    h("label", {}, "Notes", h("textarea", { name: "notes", value: trip.notes || "" })),
    err,
    h("div", { class: "row" }, h("button", { class: "primary" }, submitLabel)),
  );
  return form;
}

// --- Sidebar ---

const sidebar = document.getElementById("sidebar");
const nav = document.getElementById("trip-nav");
const toggle = document.getElementById("sidebar-toggle");
const scrim = document.getElementById("scrim");
const narrow = matchMedia("(max-width: 760px)");
let trips = [];

// Desktop remembers whether the sidebar was collapsed; on narrow screens it is a drawer that starts closed.
function savedOpen() {
  try {
    return localStorage.getItem("sidebar") !== "collapsed";
  } catch {
    return true;
  }
}

function setSidebar(open, remember = true) {
  document.body.classList.toggle("sidebar-closed", !open);
  toggle.setAttribute("aria-expanded", String(open));
  sidebar.inert = !open;
  scrim.hidden = !(open && narrow.matches);
  if (remember && !narrow.matches) {
    try {
      localStorage.setItem("sidebar", open ? "open" : "collapsed");
    } catch {}
  }
}

toggle.addEventListener("click", () => setSidebar(document.body.classList.contains("sidebar-closed")));
scrim.addEventListener("click", () => setSidebar(false));
narrow.addEventListener("change", () => setSidebar(!narrow.matches && savedOpen(), false));
setSidebar(!narrow.matches && savedOpen(), false);

function today() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

function isPast(t) {
  const last = t.end_date || t.start_date;
  return Boolean(last && last < today());
}

function currentTripId() {
  return location.hash.match(/^#\/trip\/([\w-]+)$/)?.[1];
}

async function loadTrips() {
  trips = await api("/trips");
  renderSidebar();
}

function renderSidebar() {
  const current = currentTripId();
  const item = (t) =>
    h(
      "a",
      { class: "nav-trip", href: `#/trip/${t.id}`, "aria-current": t.id === current ? "page" : null },
      h("span", { class: "name" }, t.name),
      h("span", { class: "muted small" }, [t.destination, fmtDates(t)].filter(Boolean).join(" · ")),
    );
  const upcoming = trips.filter((t) => !isPast(t));
  const past = trips.filter(isPast).reverse();
  nav.replaceChildren(
    ...[
      trips.length === 0 && h("p", { class: "muted small" }, "No trips yet."),
      upcoming.length > 0 && h("h3", {}, "Upcoming"),
      ...upcoming.map(item),
      past.length > 0 && h("h3", {}, "Past"),
      ...past.map(item),
    ].filter(Boolean),
  );
}

// --- Main area ---

function daysUntil(d) {
  const [y, m, day] = d.split("-").map(Number);
  const [ty, tm, td] = today().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, day) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function countdown(t) {
  if (!t.start_date) return null;
  const n = daysUntil(t.start_date);
  if (n > 1) return `In ${n} days`;
  if (n === 1) return "Tomorrow";
  if (n === 0) return "Starts today";
  return isPast(t) ? "Finished" : "Happening now";
}

function newTripForm() {
  return tripForm({}, async (data) => {
    const trip = await api("/trips", { method: "POST", body: data });
    await loadTrips();
    location.hash = `#/trip/${trip.id}`;
  }, "Create trip");
}

async function renderHome() {
  await tripsReady;
  const next = trips.find((t) => !isPast(t)) || trips[0];
  if (next) {
    location.replace(`#/trip/${next.id}`);
    return;
  }
  app.replaceChildren(
    h("h1", {}, "Plan your first trip"),
    h("p", { class: "muted" }, "Add a trip and it will show up in the sidebar. Everything about it lives here."),
    newTripForm(),
  );
}

function renderNew() {
  app.replaceChildren(h("h1", {}, "New trip"), newTripForm());
}

function targetItem(t, rerender) {
  return h(
    "div",
    { class: `card target${t.done ? " done" : ""}` },
    h("input", {
      type: "checkbox",
      checked: t.done,
      "aria-label": "Done",
      onchange: async (e) => {
        await api(`/targets/${t.id}`, { method: "PUT", body: { done: e.target.checked } });
        rerender();
      },
    }),
    h(
      "div",
      { class: "body" },
      h("div", { class: "title" }, t.title),
      t.location && h("div", { class: "muted" }, t.location),
      t.url && h("div", {}, h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer" }, "Link")),
      t.notes && h("div", { class: "muted" }, t.notes),
    ),
    h("button", {
      class: "link danger",
      title: "Delete",
      onclick: async () => {
        if (!confirm(`Delete "${t.title}"?`)) return;
        await api(`/targets/${t.id}`, { method: "DELETE" });
        rerender();
      },
    }, "✕"),
  );
}

async function renderTrip(id) {
  const trip = await api(`/trips/${id}`);
  const rerender = () => renderTrip(id).catch(showError);

  const groups = Object.entries(CATEGORIES)
    .map(([key, label]) => [label, trip.targets.filter((t) => t.category === key)])
    .filter(([, items]) => items.length);

  const err = h("p", { class: "error" });
  const addForm = h(
    "form",
    {
      class: "stack card",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api(`/trips/${id}/targets`, { method: "POST", body: formData(addForm) });
          rerender();
        } catch (x) {
          err.textContent = x.message;
        }
      },
    },
    h(
      "div",
      { class: "grid2" },
      h("label", {}, "What", h("input", { name: "title", required: true, placeholder: "Belém Tower" })),
      h("label", {}, "Type", h("select", { name: "category" }, Object.entries(CATEGORIES).map(([k, v]) => h("option", { value: k }, v)))),
    ),
    h(
      "div",
      { class: "grid2" },
      h("label", {}, "Where", h("input", { name: "location", placeholder: "Address or area" })),
      h("label", {}, "Link", h("input", { name: "url", type: "url", placeholder: "https://…" })),
    ),
    h("label", {}, "Notes", h("textarea", { name: "notes" })),
    err,
    h("div", { class: "row" }, h("button", { class: "primary" }, "Add target")),
  );

  const done = trip.targets.filter((t) => t.done).length;
  const when = countdown(trip);

  app.replaceChildren(
    h("h1", {}, trip.name),
    h("div", { class: "muted" }, [trip.destination, fmtDates(trip)].filter(Boolean).join(" · ")),
    h(
      "div",
      { class: "row overview" },
      when && h("span", { class: "pill" }, when),
      h("span", { class: "pill" }, `${done}/${trip.targets.length} targets done`),
    ),
    trip.notes && h("p", {}, trip.notes),
    ...(groups.length
      ? groups.flatMap(([label, items]) => [h("h2", {}, label), ...items.map((t) => targetItem(t, rerender))])
      : [h("p", { class: "muted" }, "No targets yet. Add places to see, things to do, where to eat or stay.")]),
    h("h2", {}, "Add a target"),
    addForm,
    h(
      "details",
      {},
      h("summary", {}, "Edit trip"),
      tripForm(trip, async (data) => {
        await api(`/trips/${id}`, { method: "PUT", body: data });
        await loadTrips();
        rerender();
      }, "Save changes"),
      h("button", {
        class: "danger",
        onclick: async () => {
          if (!confirm(`Delete "${trip.name}" and all its targets?`)) return;
          await api(`/trips/${id}`, { method: "DELETE" });
          await loadTrips();
          location.hash = "#/";
        },
      }, "Delete trip"),
    ),
  );
}

function router() {
  if (narrow.matches) setSidebar(false, false);
  renderSidebar();
  const id = currentTripId();
  const page = id ? renderTrip(id) : location.hash === "#/new" ? renderNew() : renderHome();
  Promise.resolve(page).catch(showError);
}

const tripsReady = loadTrips();
tripsReady.catch((err) => nav.replaceChildren(h("p", { class: "error small" }, err.message)));
window.addEventListener("hashchange", router);
api("/me")
  .then((me) => (document.getElementById("me").textContent = me.email))
  .catch(() => {});
router();
