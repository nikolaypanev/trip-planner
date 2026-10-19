import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthError, getUser, normalizeTeamDomain, verifyAccessJwt } from "../src/auth.js";

const AUD = "test-aud";

async function makeSigner() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sign = async (payload, header = { alg: "RS256", kid: "k1" }) => {
    const data = `${b64(header)}.${b64(payload)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(data));
    return `${data}.${Buffer.from(sig).toString("base64url")}`;
  };
  return { sign, fetchKeys: async () => [jwk] };
}

const signer = await makeSigner();
const later = () => Math.floor(Date.now() / 1000) + 600;
let n = 0;
// Each test uses its own team so the module's key cache doesn't leak between tests.
const newTeam = () => `team${++n}.cloudflareaccess.com`;
const claims = (team, extra = {}) => ({ aud: [AUD], iss: `https://${team}`, email: "Ana@Example.com", exp: later(), ...extra });

function req(url, token, headers = {}) {
  return new Request(url, { headers: token ? { "Cf-Access-Jwt-Assertion": token, ...headers } : headers });
}

test("accepts a valid Access token and returns the lowercased email", async () => {
  const team = newTeam();
  const token = await signer.sign(claims(team));
  const user = await getUser(req("https://trips.example.com/api/me", token), { ACCESS_TEAM_DOMAIN: `https://${team}/`, ACCESS_AUD: AUD }, undefined, signer.fetchKeys);
  assert.equal(user.email, "ana@example.com");
});

test("rejects requests with no token", async () => {
  const team = newTeam();
  await assert.rejects(
    getUser(req("https://trips.example.com/api/me"), { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: AUD }, undefined, signer.fetchKeys),
    (e) => e instanceof AuthError && e.status === 401,
  );
});

test("fails closed when Access is not configured", async () => {
  await assert.rejects(getUser(req("https://trips.example.com/api/me", "x.y.z"), {}), (e) => e.status === 500);
});

test("rejects a token signed by a different key", async () => {
  const team = newTeam();
  const other = await makeSigner();
  const token = await other.sign(claims(team));
  await assert.rejects(verifyAccessJwt(token, team, AUD, signer.fetchKeys), /signature/);
});

test("rejects a tampered payload", async () => {
  const team = newTeam();
  const [h, , s] = (await signer.sign(claims(team))).split(".");
  const forged = Buffer.from(JSON.stringify(claims(team, { email: "eve@example.com" }))).toString("base64url");
  await assert.rejects(verifyAccessJwt(`${h}.${forged}.${s}`, team, AUD, signer.fetchKeys), /signature/);
});

test("rejects wrong audience, wrong issuer and expired tokens", async () => {
  const team = newTeam();
  await assert.rejects(verifyAccessJwt(await signer.sign(claims(team, { aud: ["other"] })), team, AUD, signer.fetchKeys), /different application/);
  await assert.rejects(verifyAccessJwt(await signer.sign(claims(team, { iss: "https://evil.example" })), team, AUD, signer.fetchKeys), /different team/);
  await assert.rejects(verifyAccessJwt(await signer.sign(claims(team, { exp: 1 })), team, AUD, signer.fetchKeys), /expired/);
});

test("rejects non-RS256 tokens", async () => {
  const team = newTeam();
  const token = await signer.sign(claims(team), { alg: "none", kid: "k1" });
  await assert.rejects(verifyAccessJwt(token, team, AUD, signer.fetchKeys), /algorithm/);
});

test("dev bypass works on localhost only", async () => {
  const env = { DEV_USER_EMAIL: "dev@example.com" };
  assert.equal((await getUser(req("http://localhost:8787/api/me"), env)).email, "dev@example.com");
  await assert.rejects(getUser(req("https://trips.example.com/api/me"), env), (e) => e.status === 500);
});

test("uses the identity from Worker-level Access when present", async () => {
  const ctx = { access: { aud: "x", getIdentity: async () => ({ email: "Bo@Example.com" }) } };
  const user = await getUser(req("https://trip-planner.me.workers.dev/api/me"), {}, ctx);
  assert.equal(user.email, "bo@example.com");
});

test("falls back to the CF_Authorization cookie when the header is missing", async () => {
  const team = newTeam();
  const token = await signer.sign(claims(team));
  const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: AUD };
  const user = await getUser(req("https://trips.example.com/api/me", null, { Cookie: `theme=dark; CF_Authorization=${token}` }), env, {}, signer.fetchKeys);
  assert.equal(user.email, "ana@example.com");
});

test("a forged cookie is rejected like a forged header", async () => {
  const team = newTeam();
  const token = await (await makeSigner()).sign(claims(team));
  const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: AUD };
  await assert.rejects(getUser(req("https://trips.example.com/api/me", null, { Cookie: `CF_Authorization=${token}` }), env, {}, signer.fetchKeys), /signature/);
});

test("team domain accepts a bare team name, a host or a URL", () => {
  assert.equal(normalizeTeamDomain("npworks"), "npworks.cloudflareaccess.com");
  assert.equal(normalizeTeamDomain(" NPWorks.cloudflareaccess.com "), "npworks.cloudflareaccess.com");
  assert.equal(normalizeTeamDomain("https://npworks.cloudflareaccess.com/cdn-cgi/access/certs"), "npworks.cloudflareaccess.com");
  assert.equal(normalizeTeamDomain(""), "");
});

test("a wrong team domain is reported with the team the login came from, before fetching keys", async () => {
  const team = newTeam();
  const token = await signer.sign(claims(team));
  const neverCalled = async () => assert.fail("keys should not be fetched");
  await assert.rejects(verifyAccessJwt(token, "wrong.cloudflareaccess.com", AUD, neverCalled), new RegExp(`came from https://${team}`));
});
