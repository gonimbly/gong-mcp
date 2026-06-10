# Remote MCP Gateway (Phase 1)

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

**Phase 1 scope:** transport + authentication + identity mapping. Tools return org-wide
data, so access is restricted to a small pilot allowlist (`GONG_ALLOWED_EMAILS`).
**Phase 2 adds:** per-tool data filtering (own-calls-only, admin-only tools, etc.).

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
| `GONG_ALLOWED_EMAILS` | Comma-separated pilot allowlist |
| `GONG_ALLOWED_DOMAIN` | Defaults to `gonimbly.com` |
| `GONG_ACCESS_KEY` / `GONG_ACCESS_KEY_SECRET` | From step 2 |

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

## Phase 1 limitations

- **No per-user data filtering yet** — every allowlisted user sees org-wide data.
  Keep the allowlist to pilot users who already have broad Gong visibility.
- **In-memory sessions and client registrations** — a deploy or restart requires
  clients to re-authenticate (Claude handles this automatically).
- **Stateless JWTs** — removing a user from the allowlist takes effect at next token
  refresh (max 8 h). For immediate revocation, rotate `SESSION_SIGNING_KEY`.
