# OAuth Login & API Access Testing

## Prerequisites

- Node.js 18+
- A Gong OAuth app registered at **Gong → Settings → Ecosystem → API → Integrations → Create Integration** (Shared access, all required scopes selected — see README)
- A `.env` file in the project root with your credentials:

```
GONG_OAUTH_CLIENT_ID=your_client_id
GONG_OAUTH_CLIENT_SECRET=your_client_secret
```

---

## Testing the OAuth Login Flow via MCP Inspector

### Step 1 — Build the project

```bash
npm install && npm run build
```

### Step 2 — Start the MCP Inspector with env vars loaded

```bash
set -a && source .env && set +a && npx @modelcontextprotocol/inspector node dist/index.js
```

The inspector prints a local URL (e.g. `http://localhost:5173`) — open it in your browser.

### Step 3 — Connect

Click **Connect** in the Inspector UI. The tool list appears on the left: `gong_login`, `gong_logout`, `gong_whoami`, and all Gong data tools.

### Step 4 — Run `gong_login`

Click `gong_login` → **Run Tool** (no parameters required).

A browser tab opens pointing to Gong's OAuth authorization page (`https://app.gong.io/oauth2/authorize`). The local callback server listens on port `49201`.

### Step 5 — Authorize in Gong

Sign in with your Gong account and click **Allow**. The browser redirects to `http://127.0.0.1:49201/callback` and displays:

> **Connected to Gong!** You can close this tab and return to Claude.

The Inspector returns: `Connected to Gong! All Gong tools are now ready to use.`

### Step 6 — Verify tokens were saved

```bash
cat ~/.gong-mcp/tokens.json
```

Expected output — a JSON object containing `accessToken` (a JWT), `refreshToken`, `expiresAt` (Unix ms ~24h from now), `tokenType: "bearer"`, and your `clientId`.

### Step 7 — Confirm connection

Run `gong_whoami` in the Inspector → should return:

> `Connected to Gong. Token: expires in ~1440 minutes.`

### Step 8 — Test a live API call

Run `gong_list_calls` in the Inspector → should return paginated call data from your Gong org.

---

## API Access Validation

Once the OAuth token is obtained, access control should be validated to confirm that the token only surfaces data the authorizing user is permitted to see according to their Gong permission profile. To validate: decode the JWT payload (the middle segment, base64url-decoded) to extract the `uid` field — this is the Gong user ID of the person who authorized. Then call `GET /v2/calls` and cross-reference the returned calls against that user's expected visibility in Gong. For a standard rep account the response should be limited to calls within their team and workspace; for an admin account it will reflect org-wide access. Any call appearing in the response that falls outside the user's Gong permission profile would indicate that Shared access is not applying row-level filtering and application-level filtering (injecting `userId` as a query parameter on calls endpoints) should be considered. This validation should be performed with at least two accounts — one with restricted permissions (e.g. a rep) and one with elevated access (e.g. a manager or admin) — to confirm the boundary is enforced correctly.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GONG_OAUTH_CLIENT_ID is not set` | Env vars not loaded | Use `set -a && source .env && set +a` before running |
| `Token exchange failed (HTTP 401)` | Wrong token endpoint or missing Authorization header | Ensure you're on the latest build (`npm run build`) |
| `Command not found, transports removed` | Env var injection broke on special characters | Use `source .env` instead of `env $(cat .env \| xargs)` |
| `OAuth flow timed out` | Browser wasn't completed within 5 minutes | Run `gong_login` again |
| `OAuth flow already in progress` | `gong_login` called twice | Check your browser for an open Gong auth tab |
| API returns 401 after login | Old token from a different OAuth app | `rm ~/.gong-mcp/tokens.json` then run `gong_login` again |
