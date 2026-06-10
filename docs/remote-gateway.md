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

## How authentication works

1. A user adds the gateway in Claude (`https://<gateway>/mcp`). Claude discovers the
   OAuth metadata automatically and registers itself via Dynamic Client Registration.
2. Claude sends the user to the gateway's `/authorize`, which redirects to Google
   sign-in (restricted to the company domain).
3. After Google sign-in, the gateway checks the email against `GONG_ALLOWED_EMAILS`,
   then redirects back to Claude with an authorization code.
4. Claude exchanges the code (PKCE-verified) for a gateway-issued JWT
   (8 h access / 30 d refresh). The allowlist is re-checked on every refresh.
5. On the first MCP request, the gateway resolves the user's email to their Gong user ID
   (`/v2/users` lookup) and binds it to the session. A session can only be used by the
   user who created it.

## Deploy on Render

The repo contains `render.yaml` — create a new Blueprint service from the repo.

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
| `GONG_ALLOWED_EMAILS` | Comma-separated allowlist of users who can sign in |
| `GONG_ADMIN_EMAILS` | Comma-separated subset with org-wide access; everyone else is a member |
| `GONG_ALLOWED_DOMAIN` | Defaults to `gonimbly.com` |
| `GONG_ACCESS_KEY` / `GONG_ACCESS_KEY_SECRET` | From step 2 |
| `GONG_BASE_URL` | Your org's API endpoint as shown in Gong → Settings → API (e.g. `https://us-32447.api.gong.io`) — access keys are rejected on the generic `api.gong.io` |

### Local development

```bash
BASE_URL=http://localhost:8080 \
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
SESSION_SIGNING_KEY=dev-key \
GONG_ALLOWED_EMAILS=you@gonimbly.com \
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

- **Member visibility is "own calls only"** — narrower than Gong's native permission
  profiles (no team/manager hierarchy yet). Mirroring Gong profiles is a possible
  future enhancement.
- **In-memory sessions and client registrations** — a deploy or restart requires
  clients to re-authenticate (Claude handles this automatically).
- **Stateless JWTs** — removing a user from the allowlist takes effect at next token
  refresh (max 8 h). For immediate revocation, rotate `SESSION_SIGNING_KEY`.
- **Member call listings route through `/v2/calls/extensive`** and default to a 90-day
  window when no date range is given.
