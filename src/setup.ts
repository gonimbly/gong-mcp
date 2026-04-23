#!/usr/bin/env node
import { intro, outro, text, select, spinner, log, isCancel, cancel } from "@clack/prompts";
import { fileURLToPath } from "url";
import path from "path";
import { execFileNoThrow } from "./utils/execFileNoThrow.js";

const SERVER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js"
);

async function validateCredentials(accessKey: string, secret: string): Promise<boolean> {
  const credentials = Buffer.from(`${accessKey}:${secret}`).toString("base64");
  try {
    const res = await fetch("https://api.gong.io/v2/workspaces", {
      headers: { Authorization: `Basic ${credentials}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

intro("  Gong MCP — Setup  ");

const accessKey = await text({
  message: "Gong Access Key",
  placeholder: "paste your access key",
  validate: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
});
if (isCancel(accessKey)) { cancel("Setup cancelled."); process.exit(0); }

const accessSecret = await text({
  message: "Gong Access Key Secret",
  placeholder: "paste your access key secret",
  validate: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
});
if (isCancel(accessSecret)) { cancel("Setup cancelled."); process.exit(0); }

const s = spinner();
s.start("Validating credentials against Gong API…");
const valid = await validateCredentials(String(accessKey), String(accessSecret));
if (!valid) {
  s.stop("Validation failed.");
  log.error("Could not authenticate. Check your Access Key and Secret in Gong → Settings → API.");
  process.exit(1);
}
s.stop("Credentials validated.");

const scope = await select({
  message: "Where should this MCP be available?",
  options: [
    { value: "user", label: "All my Claude projects", hint: "stored in user settings" },
    { value: "project", label: "This project only", hint: "stored in .mcp.json" },
  ],
});
if (isCancel(scope)) { cancel("Setup cancelled."); process.exit(0); }

s.start("Registering with Claude…");
const result = await execFileNoThrow("claude", [
  "mcp", "add", "gong",
  "node", SERVER_PATH,
  "-e", `GONG_ACCESS_KEY=${String(accessKey)}`,
  "-e", `GONG_ACCESS_KEY_SECRET=${String(accessSecret)}`,
  "--scope", String(scope),
]);

if (result.status === "error") {
  s.stop("Registration failed.");
  log.error(`'claude mcp add' failed: ${result.stderr}`);
  log.info("Run this manually instead:");
  log.message(
    `claude mcp add gong node "${SERVER_PATH}" \\\n` +
    `  -e GONG_ACCESS_KEY=<your_key> \\\n` +
    `  -e GONG_ACCESS_KEY_SECRET=<your_secret> \\\n` +
    `  --scope ${String(scope)}`
  );
  process.exit(1);
}

s.stop("Registered.");
outro("Done! Restart Claude to pick up the Gong MCP tools.");
