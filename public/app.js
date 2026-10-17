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

async function renderTrips() {
  const trips = await api("/trips");
  const list = trips.length
    ? trips.map((t) =>
        h(
          "a",
          { class: "card", href: `#/trip/${t.id}` },
          h("div", { class: "row spread" }, h("strong", {}, t.name), h("span", { class: "pill" }, `${t.done_count}/${t.target_count} done`)),
          h("div", { class: "muted" }, [t.destination, fmtDates(t)].filter(Boolean).join(" · ")),
        ),
      )
    : [h("p", { class: "muted" }, "No trips yet. Add your first one below.")];

  app.replaceChildren(
    h("h1", {}, "Trips"),
    ...list,
    h(
      "details",
      { open: !trips.length },
      h("summary", {}, "New trip"),
      tripForm({}, async (data) => {
        const trip = await api("/trips", { method: "POST", body: data });
        location.hash = `#/trip/${trip.id}`;
      }, "Create trip"),
    ),
  );
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

  app.replaceChildren(
    h("a", { href: "#/" }, "← All trips"),
    h("h1", {}, trip.name),
    h("div", { class: "muted" }, [trip.destination, fmtDates(trip)].filter(Boolean).join(" · ")),
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
        rerender();
      }, "Save changes"),
      h("button", {
        class: "danger",
        onclick: async () => {
          if (!confirm(`Delete "${trip.name}" and all its targets?`)) return;
          await api(`/trips/${id}`, { method: "DELETE" });
          location.hash = "#/";
        },
      }, "Delete trip"),
    ),
  );
}

function router() {
  const m = location.hash.match(/^#\/trip\/([\w-]+)$/);
  (m ? renderTrip(m[1]) : renderTrips()).catch(showError);
}

window.addEventListener("hashchange", router);
api("/me")
  .then((me) => (document.getElementById("me").textContent = me.email))
  .catch(() => {});
router();
