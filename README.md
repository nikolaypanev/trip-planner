# trip-planner

A small, private app for planning trips and keeping track of the targets on each one: places to see, things to do, where to eat and where to stay. Everyone you invite sees and edits the same trips.

It runs entirely on Cloudflare's free tier:

- **Workers** serves the web page and a small JSON API (`src/worker.js`).
- **D1** (SQLite) stores trips and targets (`migrations/`).
- **Cloudflare Access** puts a login in front of the app. Only email addresses you list can get in. The Worker also verifies the Access token on every API call (`src/auth.js`), so the data stays closed even if Access is misconfigured.

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars        # pretends you're signed in as you@example.com
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test
```

## Deploy (one time)

You need a free Cloudflare account.

1. **Sign in from the terminal:** `npx wrangler login`
2. **Create the database:** `npx wrangler d1 create trip-planner`. Copy the `database_id` it prints into `wrangler.jsonc`.
3. **Create the tables:** `npm run db:migrate:remote`
4. **Deploy:** `npm run deploy`. It prints your URL, like `https://trip-planner.<you>.workers.dev`. Until step 6 is done, the page loads but the API answers "Cloudflare Access is not configured", so no data can be read or written.
5. **Turn on the login:** in the Cloudflare dashboard open *Workers & Pages → trip-planner → Settings → Domains & Routes* and click **Enable Cloudflare Access** next to `workers.dev`. The dialog shows your **team domain** (`<team>.cloudflareaccess.com`) and **AUD tag**.
6. **Tell the app about it:** put those two values in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) and run `npm run deploy` again.
7. **Choose who gets in:** on the same page click **Manage Cloudflare Access** and add each person's email. They sign in with a one-time code sent to that email. The free plan covers up to 50 people.

## Later changes

- New table or column: add a numbered file to `migrations/`, then `npm run db:migrate:remote`.
- Code changes: `npm run deploy`.
