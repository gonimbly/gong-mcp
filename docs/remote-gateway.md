# Remote MCP Gateway

A hosted deployment mode where the Gong MCP runs as a web service and each user
connects from Claude with their own identity. The org-wide Gong credential lives
**only on the server** — it is never distributed to user machines.

```
Claude (each user) ──OAuth (Google SSO)──▶ Gateway (Render) ──org credential──▶ Gong REST API
```

## Why

Gong does not support user-level OAuth against its REST API — any credential that can
call the API is org-wide. The only way to give individual users scoped access is to put
the credential behind a gateway that authenticates each user and (Phase 2) filters what
each user can see.

## Access model

The gateway has two access models (plus a diagnostic), selected by `GONG_POLICY_MODE`:

- **`profiles`** (default) — Phase 3: each user gets the same data access as in the
  Gong UI, driven by their actual Gong permission profile
- **`binary`** — the Phase 2 admin/member model below; the rollback path
- **`shadow`** — enforces `binary` while logging every decision the profile-based
  policy would change (`[policy] SHADOW diff …`); a diagnostic for comparing the two

### `binary` mode (Phase 2)

Every user is either a **member** or an **admin** (`GONG_ADMIN_EMAILS`). Admins get
org-wide passthrough. For members, every tool call goes through a policy layer
(`src/gong/scopedClient.ts`) bound to their Gong identity:

| Policy | Behavior | Applies to |
|---|---|---|
| **Participant-checked** | Only calls the member took part in are returned; transcripts of other calls are refused | `gong_list_calls`, `gong_get_call`, `gong_get_extensive_calls`, `gong_get_transcripts` |
| **Self-scoped** | The member's own Gong userId is forced into the filter — user-supplied `userIds` are ignored | all stats tools, coaching |
| **Admin-only** | Refused with a clear message | AI Q&A/briefs (they synthesize from org-wide calls), all writes (calls, CRM, meetings, flows, tasks, engagement), permissions, data privacy, audit logs, integrations, extensive user data |
| **Open** | Allowed as-is (harmless or deliberately shared metadata) | workspaces, trackers, scorecards, user directory, library folders, flow/CRM reads |

Denials are logged server-side (`[policy] DENY …`) for auditability. Member call
listings are filtered per page, so a page may contain fewer items than the page
size — clients should keep paginating with the returned cursor.

### `profiles` mode (Phase 3)

Every session resolves the user's Gong permission profile (cached org-wide for 1h)
into a per-workspace policy — see `docs/phase3-access-control-plan.md` for the full
design and `docs/phase3a-discovery.md` for the org's live profile data:

| Surface | Behavior |
|---|---|
| Calls / transcripts | Each call is visible iff a party is in the user's visible set for that call's workspace (`all` / `managers-team` / `report-to-them` / `none`, expanded through the manager graph) |
| Stats / coaching | Requested `userIds` are intersected with the visible set; a manager gets their team, an IC gets themself |
| AI Q&A / briefs | Require unrestricted call access in the target workspace |
| Deals / CRM / library / writes / admin tools | Gated on the profile's access levels and capability booleans (`crmDataImport`, `manuallyScheduleAndUploadCalls`, `manageGeneralBusinessSettings`, …) |

**Fail closed:** if the profile cannot be resolved (API failure, user in no
profile), the session degrades to the member policy above — own data only — and
logs `[policy] DEGRADED`. `GONG_ADMIN_EMAILS` remains a break-glass org-wide
override in this mode.

### Rollout status & rollback

`profiles` has been live in prod since 2026-06-12. The shadow soak originally
planned for the rollout was consciously skipped — the env-var rollback is cheap
and the `GONG_ADMIN_EMAILS` break-glass keeps admin access in every mode.

- **Rollback** = set `GONG_POLICY_MODE=binary` in the Render dashboard (no data
  migration; sessions pick it up on next connect). Unset no longer means
  `binary` — the in-code default is `profiles`.
- **Rollback trigger:** any report of a user seeing data the Gong UI denies them.
- **User reports *missing* access?** Check the logs for `[policy] DEGRADED`
  first — a user in no permission profile fails closed to own-data-only by
  design. That's a profile assignment to fix in Gong, not a resolver bug.
- **After any resolver/policy change:** run `npm run smoke:policy -- <email>`
  (see `tests/manual/README.md`) for at least one user per permission profile,
  and spot-check the Gong UI against MCP results for a scoped persona.
- `shadow` mode remains wired in as a diagnostic: it enforces `binary` while
  logging every decision the profile policy would change (`[policy] SHADOW diff`).

## How authentication works

1. A user adds the gateway in Claude (`https://<gateway>/mcp`). Claude discovers the
   OAuth metadata automatically and registers itself via Dynamic Client Registration.
2. Claude sends the user to the gateway's `/authorize`, which redirects to Google
   sign-in (restricted to the company domain).
3. After Google sign-in, the gateway verifies the account is on `GONG_ALLOWED_DOMAIN`
   (and on `GONG_ALLOWED_EMAILS` if that restriction is set), then redirects back to
   Claude with an authorization code.
4. Claude exchanges the code (PKCE-verified) for a gateway-issued JWT
   (8 h access / 30 d refresh). Domain and allowlist are re-checked on every refresh.
5. On the first MCP request, the gateway resolves the user's email to their Gong user ID
   (`/v2/users` lookup) and binds it to the session. A session can only be used by the
   user who created it.

## CI/CD

`.github/workflows/ci.yml` runs build + the unit-test suite on every pull request.
On push to `main`, after tests pass, semantic-release cuts a release, then the
workflow triggers a Render deploy via the service's deploy hook
(`RENDER_DEPLOY_HOOK_URL` repo secret). Render's native auto-deploy is disabled
(`autoDeploy: false` in `render.yaml`) so untested code never ships.

When a release is published the release job also posts its notes to the Slack
alerts channel (`ALERT_SLACK_WEBHOOK_URL` repo **Actions secret** — the same
incoming-webhook URL the runtime alerts use; add it under Settings → Secrets and
variables → Actions). semantic-release runs with the default `GITHUB_TOKEN`, so a
separate workflow keyed on the GitHub `release` event would never fire — the post
happens inside the release job. Notes are converted from Markdown to Slack mrkdwn
by `scripts/md-to-mrkdwn.ts`. If the secret is unset the step logs a warning and
skips. (Releases that aren't published — pushes with no `feat`/`fix` commits —
post nothing.)

Pipeline: `PR → CI (build + tests) → merge to main → CI → semantic-release → Slack notes + Render deploy hook → live`

## Deploy on Render (one-time setup)

The repo contains `render.yaml` — create a new Blueprint service from the repo:

1. Render dashboard → **New → Blueprint** → connect `gonimbly/gong-mcp` → Render
   reads `render.yaml` and prompts for the `sync: false` env vars (see table below).
2. After the service exists, copy its URL (e.g. `https://gong-mcp-gateway.onrender.com`)
   into the `BASE_URL` env var, and add
   `https://gong-mcp-gateway.onrender.com/auth/google/callback` as an authorized
   redirect URI on the Google OAuth client.
3. Service → **Settings → Deploy Hook** → copy the URL → GitHub repo →
   **Settings → Secrets and variables → Actions** → new secret
   `RENDER_DEPLOY_HOOK_URL`.
4. Trigger the first deploy manually (Render dashboard → Manual Deploy) or push to
   `main`. Watch the logs for `Gong credential check: OK`.

### 1. Create a Google OAuth client

Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID:

- Application type: **Web application**
- Authorized redirect URI: `https://<your-service>.onrender.com/auth/google/callback`

### 2. Create the org Gong credential

Gong → Settings → API → Access Keys (Technical Administrator) → create a key pair.
This is the server-side credential; it is never shared with users.

### 3. Environment variables

| Var | Value |
|---|---|
| `BASE_URL` | Public URL of the service, no trailing slash |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | From step 1 |
| `SESSION_SIGNING_KEY` | Long random string (Render generates it via the blueprint) |
| `GONG_ALLOWED_EMAILS` | Optional — unset means any verified `GONG_ALLOWED_DOMAIN` account can sign in (as a member). Set a comma-separated list to restrict sign-in, e.g. during a pilot |
| `GONG_ADMIN_EMAILS` | Comma-separated admins with org-wide access; everyone else is a member (break-glass override in `profiles` mode) |
| `GONG_POLICY_MODE` | Optional — `profiles` (default), `binary` (rollback), or `shadow` (diagnostic); see "Access model" above |
| `GONG_ALLOWED_DOMAIN` | Defaults to `gonimbly.com` |
| `GONG_ACCESS_KEY` / `GONG_ACCESS_KEY_SECRET` | From step 2 |
| `GONG_BASE_URL` | Your org's API endpoint as shown in Gong → Settings → API (e.g. `https://us-32447.api.gong.io`) — access keys are rejected on the generic `api.gong.io` |
| `GONG_DAILY_QUOTA` | Optional — your org's negotiated daily Gong API request limit. Defaults to Gong's documented **10,000/day** (the cap is not discoverable via the API). The tracker hard-stops at this number and always raises the first Slack alert by the 10,000 mark, even if you set it higher |

### Local development

```bash
BASE_URL=http://localhost:8080 \
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
SESSION_SIGNING_KEY=dev-key \
GONG_ALLOWED_EMAILS=you@gonimbly.com \  # optional — restrict sign-in while developing
GONG_DEV_KEYCHAIN_FALLBACK=1 \
npm run dev:http
```

`GONG_DEV_KEYCHAIN_FALLBACK=1` lets the gateway use the keychain token from a local
`gong_login` instead of env access keys. Dev only.

## Connecting from Claude

**Claude Code:**

```bash
claude mcp add --transport http gong https://<your-service>.onrender.com/mcp
```

**Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector →
URL `https://<your-service>.onrender.com/mcp`. Claude runs the Google sign-in flow
in the browser on first use.

## Known limitations

- **`binary` mode and degraded sessions are "own calls only"** — narrower than
  Gong's native permission profiles. In the default `profiles` mode this applies
  only when a user's profile cannot be resolved (fail-closed `[policy] DEGRADED`
  sessions).
- **In-memory sessions and client registrations** — a deploy or restart requires
  clients to re-authenticate (Claude handles this automatically).
- **Stateless JWTs** — access revocation (removing someone from the allowlist, or a
  user leaving the Google domain) takes effect at next token refresh (max 8 h). For
  immediate revocation of everyone's sessions, rotate `SESSION_SIGNING_KEY`.
- **Member call listings route through `/v2/calls/extensive`** and default to a 90-day
  window when no date range is given.
