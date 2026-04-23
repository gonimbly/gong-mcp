# gong-mcp

A Model Context Protocol server for the [Gong REST API](https://gong.app.gong.io/settings/api/documentation). Give Claude access to your calls, transcripts, reps, pipeline, and more.

> Your Gong data is sitting there, full of signal. This gets it talking to Claude.

---

## Install

You need Node.js 18+ and a Gong account with API access.

```bash
npm install -g github:gonimbly/gong-mcp
gong-mcp-setup
```

The setup wizard will:
1. Ask for your Gong Access Key and Secret
2. Validate them against the Gong API
3. Register the MCP with Claude automatically

To get your credentials: **Gong → Settings → API → Access Keys → Create** (requires Technical Administrator role).

---

## What's inside

38 tools across 12 modules:

| Module | What you get |
|---|---|
| **Calls** | List, get, transcripts, enriched content (topics, trackers, key points, next steps, outcomes) |
| **Users** | List, get, settings history, filter by email |
| **Stats** | Aggregate, by period, day-by-day, scorecard stats, interaction stats |
| **Entities** | `ask_entity` — ask Gong's AI a question about an account or deal. `get_entity_brief` — AI-generated executive summary |
| **Settings** | Scorecards, trackers, workspaces, coaching data |
| **Library** | Folders and saved clips |
| **CRM** | Entities, schema, integrations |
| **Flows** | List flows, assign prospects, bulk assignments |
| **Meetings** | Create, update, delete |
| **Permissions** | Profiles and user access |
| **Data Privacy** | Look up and erase data by email or phone (GDPR/CCPA) |
| **Logs** | Audit logs |

### Highlight tools

**`gong_ask_entity`** — Ask Gong's AI a natural-language question about any account or opportunity. "What are the main objections?" "Which competitors came up?" "What's the deal risk?" Gong synthesizes the answer from every related call.

**`gong_get_entity_brief`** — Get an AI-generated executive brief for an account or deal. All the signal, none of the call-listening.

**`gong_get_extensive_calls`** — Single API call that returns calls enriched with topics, trackers, briefs, key points, outcomes, next steps, and speaker stats. The one tool to rule them all.

---

## Example prompts

Once installed, you can ask Claude things like:

- *"Summarize all calls with Acme Corp this month"*
- *"What are the top objections reps are hearing this quarter?"*
- *"Which deals have gone quiet in the last 30 days?"*
- *"Pull the transcript from my call with Sarah yesterday"*
- *"How is [rep name]'s talk ratio trending?"*
- *"What competitors are coming up most in discovery calls?"*

---

## Manual setup (alternative)

If you prefer to configure it yourself, add this to your Claude MCP config:

```json
{
  "mcpServers": {
    "gong": {
      "command": "node",
      "args": ["/path/to/gong-mcp/dist/index.js"],
      "env": {
        "GONG_ACCESS_KEY": "your_key",
        "GONG_ACCESS_KEY_SECRET": "your_secret"
      }
    }
  }
}
```

**Claude Code:** `~/.claude/settings.json`  
**Claude Desktop (Mac):** `~/Library/Application Support/Claude/claude_desktop_config.json`

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
