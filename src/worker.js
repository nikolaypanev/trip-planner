import { AuthError, getUser } from "./auth.js";

const CATEGORIES = ["see", "do", "eat", "stay", "other"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      const user = await getUser(request, env, ctx);
      return await route(request, env, url, user);
    } catch (err) {
      if (err instanceof AuthError || err instanceof HttpError) {
        return json({ error: err.message }, err.status);
      }
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function route(request, env, url, user) {
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\/|\/$/g, "").split("/");
  const db = env.DB;

  if (parts[0] === "me" && parts.length === 1 && method === "GET") {
    return json({ email: user.email });
  }

  if (parts[0] === "trips") {
    const [, tripId, sub] = parts;

    if (!tripId) {
      if (method === "GET") return json(await listTrips(db));
      if (method === "POST") return json(await createTrip(db, await readBody(request), user), 201);
    } else if (!sub) {
      if (method === "GET") return json(await getTrip(db, tripId));
      if (method === "PUT") return json(await updateTrip(db, tripId, await readBody(request)));
      if (method === "DELETE") return json(await deleteTrip(db, tripId));
    } else if (sub === "targets" && parts.length === 3 && method === "POST") {
      return json(await createTarget(db, tripId, await readBody(request), user), 201);
    }
  }

  if (parts[0] === "targets" && parts.length === 2) {
    if (method === "PUT") return json(await updateTarget(db, parts[1], await readBody(request)));
    if (method === "DELETE") return json(await deleteTarget(db, parts[1]));
  }

  throw new HttpError(404, "Not found");
}

// --- Trips ---

async function listTrips(db) {
  const { results } = await db
    .prepare(
      `SELECT t.*,
              COUNT(g.id) AS target_count,
              COALESCE(SUM(g.done), 0) AS done_count
         FROM trips t
         LEFT JOIN targets g ON g.trip_id = t.id
        GROUP BY t.id
        ORDER BY (t.start_date IS NULL), t.start_date, t.created_at`,
    )
    .all();
  return results;
}

async function getTrip(db, id) {
  const trip = await db.prepare("SELECT * FROM trips WHERE id = ?").bind(id).first();
  if (!trip) throw new HttpError(404, "Trip not found");
  const { results } = await db
    .prepare("SELECT * FROM targets WHERE trip_id = ? ORDER BY done, (visit_at IS NULL), visit_at, created_at")
    .bind(id)
    .all();
  trip.targets = results.map(toTarget);
  return trip;
}

async function createTrip(db, body, user) {
  const trip = tripFields(body, true);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO trips (id, name, destination, start_date, end_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, trip.name, trip.destination ?? "", trip.start_date ?? null, trip.end_date ?? null, trip.notes ?? "", user.email)
    .run();
  return getTrip(db, id);
}

async function updateTrip(db, id, body) {
  const fields = tripFields(body, false);
  await applyUpdate(db, "trips", id, fields, "Trip not found");
  return getTrip(db, id);
}

async function deleteTrip(db, id) {
  const [, res] = await db.batch([
    db.prepare("DELETE FROM targets WHERE trip_id = ?").bind(id),
    db.prepare("DELETE FROM trips WHERE id = ?").bind(id),
  ]);
  if (!res.meta.changes) throw new HttpError(404, "Trip not found");
  return { ok: true };
}

function tripFields(body, requireName) {
  const out = {};
  if (requireName || "name" in body) out.name = text(body.name, "name", 200, true);
  if ("destination" in body) out.destination = text(body.destination, "destination", 200);
  if ("notes" in body) out.notes = text(body.notes, "notes", 5000);
  if ("start_date" in body) out.start_date = date(body.start_date, "start_date");
  if ("end_date" in body) out.end_date = date(body.end_date, "end_date");
  if (out.start_date && out.end_date && out.end_date < out.start_date) {
    throw new HttpError(400, "end_date is before start_date");
  }
  return out;
}

// --- Targets ---

async function createTarget(db, tripId, body, user) {
  const trip = await db.prepare("SELECT id FROM trips WHERE id = ?").bind(tripId).first();
  if (!trip) throw new HttpError(404, "Trip not found");

  const t = targetFields(body, true);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO targets (id, trip_id, title, category, location, directions, tickets, hours, visit_at, url, notes, done, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      tripId,
      t.title,
      t.category ?? "see",
      t.location ?? "",
      t.directions ?? "",
      t.tickets ?? "",
      t.hours ?? "",
      t.visit_at ?? null,
      t.url ?? "",
      t.notes ?? "",
      t.done ?? 0,
      user.email,
    )
    .run();
  return getTarget(db, id);
}

async function updateTarget(db, id, body) {
  await applyUpdate(db, "targets", id, targetFields(body, false), "Target not found");
  return getTarget(db, id);
}

async function deleteTarget(db, id) {
  const res = await db.prepare("DELETE FROM targets WHERE id = ?").bind(id).run();
  if (!res.meta.changes) throw new HttpError(404, "Target not found");
  return { ok: true };
}

async function getTarget(db, id) {
  const row = await db.prepare("SELECT * FROM targets WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "Target not found");
  return toTarget(row);
}

function toTarget(row) {
  return { ...row, done: Boolean(row.done) };
}

function targetFields(body, requireTitle) {
  const out = {};
  if (requireTitle || "title" in body) out.title = text(body.title, "title", 200, true);
  if ("category" in body) {
    if (!CATEGORIES.includes(body.category)) {
      throw new HttpError(400, `category must be one of: ${CATEGORIES.join(", ")}`);
    }
    out.category = body.category;
  }
  if ("location" in body) out.location = text(body.location, "location", 300);
  if ("directions" in body) out.directions = text(body.directions, "directions", 2000);
  if ("tickets" in body) out.tickets = text(body.tickets, "tickets", 1000);
  if ("hours" in body) out.hours = text(body.hours, "hours", 1000);
  if ("visit_at" in body) out.visit_at = dateTime(body.visit_at, "visit_at");
  if ("url" in body) out.url = link(body.url);
  if ("notes" in body) out.notes = text(body.notes, "notes", 5000);
  if ("done" in body) {
    if (typeof body.done !== "boolean") throw new HttpError(400, "done must be true or false");
    out.done = body.done ? 1 : 0;
  }
  return out;
}

// --- Helpers ---

// Column names come only from the *Fields() validators above, never from the request.
async function applyUpdate(db, table, id, fields, notFound) {
  const cols = Object.keys(fields);
  if (!cols.length) throw new HttpError(400, "Nothing to update");
  const sets = cols.map((c) => `${c} = ?`).join(", ");
  const res = await db
    .prepare(`UPDATE ${table} SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, notFound);
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "Expected a JSON object");
}

function text(value, name, max, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `${name} must be text`);
  value = value.trim();
  if (required && !value) throw new HttpError(400, `${name} is required`);
  if (value.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return value;
}

function date(value, name) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} must be a date like 2026-05-31`);
  }
  return value;
}

function dateTime(value, name) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} must be a date and time like 2026-05-31T14:30`);
  }
  return value;
}

function link(value) {
  value = text(value, "url", 2000);
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {}
  throw new HttpError(400, "url must start with http:// or https://");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
