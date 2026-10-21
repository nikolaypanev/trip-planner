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

## Automatic deploys

Every merge to `main` is tested, migrated and deployed by GitHub Actions (`.github/workflows/deploy.yml`). Pull requests only run the tests. You can also start a deploy by hand under *Actions → Test and deploy → Run workflow*.

One-time setup, in the GitHub repo under *Settings → Secrets and variables → Actions*:

- **Secrets**
  - `CLOUDFLARE_API_TOKEN`: create it in the Cloudflare dashboard under *My Profile → API Tokens → Create Token → Create Custom Token* with these account permissions: **Workers Scripts: Edit** and **D1: Edit**. Limit it to your account.
  - `CLOUDFLARE_ACCOUNT_ID`: shown on the right of *Workers & Pages → Overview*, or via `npx wrangler whoami`.
- **Variables** (the same values you put in your local `wrangler.jsonc`)
  - `D1_DATABASE_ID`
  - `ACCESS_TEAM_DOMAIN`
  - `ACCESS_AUD`

The committed `wrangler.jsonc` keeps placeholders; the workflow fills these in before deploying.

### Database changes

Add a numbered file to `migrations/` in the same pull request as the code that needs it. On merge, the workflow applies new migrations first and deploys the code second, so the new code never runs against the old schema. Two rules keep that safe:

- **Additive only.** For a moment the old code runs against the new schema, so add tables and columns (with defaults or nullable) rather than renaming or dropping them. To remove something, stop using it in one release and drop it in a later one.
- **Never edit a migration that has already been applied.** D1 records which files ran and won't re-run a changed one; fix mistakes with a new numbered file.

If a migration fails, the deploy is skipped and production keeps running the previous code.

## Troubleshooting

- **"Not signed in"**: the request reached the app without a Cloudflare Access login. Open the app at the exact `workers.dev` URL that Access protects, sign in with the emailed code, and reload. If it persists, check that Access is enabled for **production** (not only previews) under *Settings → Domains & Routes*.
- **"Cloudflare Access is not configured"**: `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is empty in `wrangler.jsonc`. Fill both in (step 6) and deploy again.
- **"Token is for a different application"**: `ACCESS_AUD` doesn't match the AUD tag shown in the Access dialog.
