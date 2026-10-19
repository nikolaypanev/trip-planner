// Identifies the signed-in user. Cloudflare Access checks the login before a
// request reaches the Worker; depending on how Access was turned on, it hands
// the identity over as `ctx.access`, as the Cf-Access-Jwt-Assertion header, or
// only as the browser's CF_Authorization cookie. Tokens are verified here too,
// so the API stays closed even if someone reaches the Worker by a URL Access
// doesn't cover.

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const keyCache = new Map(); // team domain -> { keys, fetchedAt }
const KEY_TTL_MS = 60 * 60 * 1000;

export async function getUser(request, env, ctx, fetchKeys = fetchAccessKeys) {
  // Local development: `.dev.vars` sets DEV_USER_EMAIL. Honoured only on localhost.
  if (env.DEV_USER_EMAIL && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return { email: env.DEV_USER_EMAIL };
  }

  // Worker-level Access ("Enable Cloudflare Access" on the Worker) provides the
  // identity directly. The platform sets this, so it needs no verification.
  if (ctx?.access) {
    const identity = await ctx.access.getIdentity();
    if (identity?.email) return { email: identity.email.toLowerCase() };
  }

  const team = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  if (!team || !env.ACCESS_AUD) {
    throw new AuthError(500, "Cloudflare Access is not configured for this app");
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion") || getCookie(request, "CF_Authorization");
  if (!token) throw new AuthError(401, "Not signed in");

  const payload = await verifyAccessJwt(token, team, env.ACCESS_AUD, fetchKeys);
  if (!payload.email) throw new AuthError(403, "Token has no email");
  return { email: payload.email.toLowerCase() };
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Accepts "myteam", "myteam.cloudflareaccess.com" or a full https:// URL.
export function normalizeTeamDomain(value) {
  const host = (value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!host) return "";
  return host.includes(".") ? host : `${host}.cloudflareaccess.com`;
}

export async function verifyAccessJwt(token, team, aud, fetchKeys = fetchAccessKeys, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError(401, "Malformed token");

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    throw new AuthError(401, "Malformed token");
  }
  if (header.alg !== "RS256") throw new AuthError(401, "Unsupported token algorithm");
  // Checked before fetching keys so a wrong ACCESS_TEAM_DOMAIN gets a message that names the right one.
  if (payload.iss !== `https://${team}`) {
    throw new AuthError(
      403,
      `Token is from a different team: this login came from ${payload.iss}, but ACCESS_TEAM_DOMAIN is "${team}"`,
    );
  }

  const jwk = await findKey(team, header.kid, fetchKeys);
  if (!jwk) throw new AuthError(401, "Unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new AuthError(401, "Invalid token signature");

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new AuthError(403, "Token is for a different application");
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) throw new AuthError(401, "Token expired");
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) throw new AuthError(401, "Token not yet valid");

  return payload;
}

async function findKey(team, kid, fetchKeys) {
  const cached = keyCache.get(team);
  if (cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) {
    const hit = cached.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  // Unknown kid or stale cache: Access may have rotated its keys, so refetch.
  const keys = await fetchKeys(team);
  keyCache.set(team, { keys, fetchedAt: Date.now() });
  return keys.find((k) => k.kid === kid);
}

async function fetchAccessKeys(team) {
  const url = `https://${team}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(503, `Could not load Access signing keys from ${url} (HTTP ${res.status})`);
  const body = await res.json();
  return body.keys || [];
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}
