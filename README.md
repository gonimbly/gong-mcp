# gong-mcp

A Model Context Protocol server for the [Gong REST API](https://gong.app.gong.io/settings/api/documentation). Give Claude access to your calls, transcripts, reps, pipeline, and more.

> Your Gong data is sitting there, full of signal. This gets it talking to Claude.

Two ways to run it:

- **Hosted gateway (recommended for teams)** — a deployed web service with Google SSO and per-user data access control. By default members only see their own calls and stats; with `GONG_POLICY_MODE=profiles` the gateway mirrors each user's actual Gong permission profile (team-scoped calls, manager stats, capability-gated writes — see [docs/phase3-access-control-plan.md](docs/phase3-access-control-plan.md)). No local install; users just add a connector URL in Claude. See [docs/remote-gateway.md](docs/remote-gateway.md).
- **Local install (below)** — runs on your machine via stdio, authenticating with a Gong OAuth app. Full org access for whoever holds the credential.

---

## Install

You need Node.js 18+ and a Gong account with API access.

```bash
npm install -g github:gonimbly/gong-mcp
gong-mcp-setup
```

The setup wizard registers the MCP with Claude Desktop and/or Claude Code. Both are selected by default.

**Before running setup**, create an OAuth app in Gong: **Settings → API → OAuth Apps → Create**. You'll need the Client ID (and optionally Client Secret) during setup.

---

## Connecting your Gong account

Once installed, open Claude and say:

> *"Login to Gong"*

Claude calls the `gong_login` tool, which opens a browser window. Sign in with your Gong account — access is scoped to your user permissions, not the full org. Tokens are saved locally and auto-refreshed.

To check your connection at any time:

> *"Check my Gong connection"* → runs `gong_whoami`

To disconnect:

> *"Logout of Gong"* → runs `gong_logout`

OAuth tokens are stored in `~/.gong-mcp/tokens.json` (owner read/write only). The OAuth client ID and secret are passed as env vars (`GONG_OAUTH_CLIENT_ID` / `GONG_OAUTH_CLIENT_SECRET`) by the setup wizard.

---

## What's inside

40 tools across 13 modules:

| Module | What you get |
|---|---|
| **Setup** | `gong_login` — connect via OAuth browser flow. `gong_logout` — disconnect. `gong_whoami` — check connection status |
| **Calls** | List, get, transcripts, enriched content (topics, trackers, key points, next steps, outcomes) |
| **Users** | List, get, settings history, filter by email |
| **Stats** | Aggregate, by period, day-by-day, scorecard stats, interaction stats |
| **Entities** | `gong_ask_account`, `gong_ask_deal` — targeted AI Q&A. `gong_generate_brief` — structured multi-category AI summary |
| **Settings** | Scorecards, trackers, workspaces, coaching data |
| **Library** | Folders and saved clips |
| **CRM** | Entities, schema, integrations |
| **Flows** | List flows, assign prospects, bulk assignments |
| **Meetings** | Create, update, delete |
| **Permissions** | Profiles and user access |
| **Data Privacy** | Look up and erase data by email or phone (GDPR/CCPA) |
| **Logs** | Audit logs |

### Highlight tools

**`gong_ask_account`** — Ask Gong's AI a targeted natural-language question about a CRM account. "What are the main objections?" "Which competitors came up?" "What are the open risks?" Gong synthesizes the answer from every related call in the time window.

**`gong_ask_deal`** — Same thing, scoped to a deal/opportunity. "What are the blockers preventing this from closing?" "What did the champion say about budget?"

**`gong_generate_brief`** — Generate a comprehensive structured brief for an account, deal, or contact: themes, stakeholders, risks, recent news. Built for exec briefings, deal reviews, and handover docs.

**`gong_get_extensive_calls`** — Single API call that returns calls enriched with topics, trackers, briefs, key points, outcomes, next steps, and speaker stats. The one tool to rule them all.

> **Note:** The three AI tools above (`gong_ask_account`, `gong_ask_deal`, `gong_generate_brief`) require **Gen AI Beta** and **MCP Server Beta** feature flags to be enabled on your Gong org. Contact your Gong Technical Administrator to activate them.

---

## Example prompts

Once connected, you can ask Claude things like:

- *"Login to Gong"* — opens browser OAuth flow to connect your account
- *"Summarize all calls with Acme Corp this month"*
- *"What are the top objections reps are hearing this quarter?"*
- *"Which deals have gone quiet in the last 30 days?"*
- *"Pull the transcript from my call with Sarah yesterday"*
- *"How is [rep name]'s talk ratio trending?"*
- *"What competitors are coming up most in discovery calls?"*

---

## Manual config (alternative to the setup wizard)

If you prefer to configure Claude Desktop manually, add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac):

```json
{
  "mcpServers": {
    "gong": {
      "command": "node",
      "args": ["/path/to/gong-mcp/dist/index.js"]
    }
  }
}
```

For Claude Code: `~/.claude/settings.json` using the same structure under `mcpServers`.

---

## Development

```bash
git clone https://github.com/gonimbly/gong-mcp
cd gong-mcp
npm install
npm run dev       # run server with tsx (no build step)
npm run build     # compile to dist/
npm run setup     # run setup wizard locally
```

---

## Contributing

PRs welcome. The Gong API has a lot of surface area and some of the write endpoints (CRM upserts, flow assignments) are less tested than the read ones. If you find a bug or a better request shape, open an issue.

---

Built by [GoNimbly](https://gonimbly.com).
