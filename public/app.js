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

// --- Sights (targets) ---

function fmtVisit(v) {
  return new Date(v).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function mapsLink(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

function sightForm(sight = {}, onSubmit, submitLabel, onCancel) {
  const err = h("p", { class: "error" });
  const field = (label, input, hint) => h("label", {}, h("span", {}, label, hint && h("span", { class: "optional" }, ` ${hint}`)), input);
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
    h(
      "div",
      { class: "grid2" },
      field("Name", h("input", { name: "title", required: true, value: sight.title || "", placeholder: "Belém Tower" })),
      field("Location", h("input", { name: "location", required: true, value: sight.location || "", placeholder: "Av. Brasília, Lisbon" })),
    ),
    field("How to get there", h("textarea", { name: "directions", required: true, rows: 2, value: sight.directions || "", placeholder: "Tram 15E from Praça da Figueira to Belém, ~25 min" })),
    h(
      "div",
      { class: "grid2" },
      field("Ticket prices", h("textarea", { name: "tickets", required: true, rows: 2, value: sight.tickets || "", placeholder: "Adult €10, under 12 free" })),
      field("Visiting hours", h("textarea", { name: "hours", required: true, rows: 2, value: sight.hours || "", placeholder: "Tue–Sun 10:00–18:30, closed Mon" })),
    ),
    h(
      "div",
      { class: "grid2" },
      field("Website", h("input", { name: "url", type: "url", value: sight.url || "", placeholder: "https://…" }), "(optional)"),
      field("Visit appointment", h("input", { name: "visit_at", type: "datetime-local", value: sight.visit_at || "" }), "(optional)"),
    ),
    err,
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary" }, submitLabel),
      onCancel && h("button", { type: "button", onclick: onCancel }, "Cancel"),
    ),
  );
  return form;
}

function sightCard(t, rerender) {
  const detail = (label, value) => value && h("div", { class: "detail" }, h("dt", {}, label), h("dd", {}, value));
  const card = h(
    "article",
    { class: `card sight${t.done ? " done" : ""}` },
    h(
      "header",
      { class: "sight-head" },
      h("input", {
        type: "checkbox",
        checked: t.done,
        title: "Visited",
        "aria-label": "Visited",
        onchange: async (e) => {
          await api(`/targets/${t.id}`, { method: "PUT", body: { done: e.target.checked } });
          rerender();
        },
      }),
      h("h3", { class: "title" }, t.title),
      t.visit_at && h("span", { class: "pill accent" }, `Booked ${fmtVisit(t.visit_at)}`),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "link", onclick: () => card.replaceWith(editForm()) }, "Edit"),
        h("button", {
          class: "link danger",
          title: "Delete",
          onclick: async () => {
            if (!confirm(`Delete "${t.title}"?`)) return;
            await api(`/targets/${t.id}`, { method: "DELETE" });
            rerender();
          },
        }, "Delete"),
      ),
    ),
    h(
      "dl",
      { class: "details" },
      detail("Location", t.location && h("a", { href: mapsLink(t.location), target: "_blank", rel: "noopener noreferrer" }, t.location)),
      detail("How to get there", t.directions),
      detail("Tickets", t.tickets),
      detail("Hours", t.hours),
      detail("Website", t.url && h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer" }, new URL(t.url).hostname)),
      detail("Notes", t.notes),
    ),
  );
  const editForm = () => {
    const form = sightForm(t, async (data) => {
      await api(`/targets/${t.id}`, { method: "PUT", body: data });
      rerender();
    }, "Save", () => form.replaceWith(card));
    return form;
  };
  return card;
}

function tile(label, value, sub) {
  return h("div", { class: "tile" }, h("div", { class: "tile-label" }, label), h("div", { class: "tile-value" }, value), sub && h("div", { class: "muted small" }, sub));
}

async function renderTrip(id) {
  const trip = await api(`/trips/${id}`);
  const rerender = () => renderTrip(id).catch(showError);

  const sights = trip.targets;
  const visited = sights.filter((t) => t.done).length;
  const nextVisit = sights.filter((t) => t.visit_at && !t.done).sort((a, b) => a.visit_at.localeCompare(b.visit_at))[0];

  app.replaceChildren(
    h("h1", {}, trip.name),
    h("div", { class: "muted" }, [trip.destination, fmtDates(trip)].filter(Boolean).join(" · ")),
    trip.notes && h("p", {}, trip.notes),
    h(
      "section",
      { class: "tiles" },
      tile("Countdown", countdown(trip) || "No dates yet", trip.start_date && fmtDates(trip)),
      tile("Sights", String(sights.length), sights.length ? `${visited} visited` : "None added yet"),
      tile("Next visit", nextVisit ? fmtVisit(nextVisit.visit_at) : "Nothing booked", nextVisit?.title),
    ),
    h(
      "section",
      { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Sights & landmarks"), h("span", { class: "muted small" }, `${visited}/${sights.length} visited`)),
      ...(sights.length
        ? sights.map((t) => sightCard(t, rerender))
        : [h("p", { class: "muted" }, "No sights yet. Add the landmarks you want to see on this trip.")]),
      h(
        "details",
        { class: "add-sight", open: !sights.length },
        h("summary", {}, "+ Add a sight"),
        sightForm({}, async (data) => {
          await api(`/trips/${id}/targets`, { method: "POST", body: { ...data, category: "see" } });
          rerender();
        }, "Add sight"),
      ),
    ),
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
          if (!confirm(`Delete "${trip.name}" and all its sights?`)) return;
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
