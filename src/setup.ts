#!/usr/bin/env node
import { intro, outro, text, select, multiselect, spinner, log, isCancel, cancel } from "@clack/prompts";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { execFileNoThrow } from "./utils/execFileNoThrow.js";

const SERVER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js"
);

const CLAUDE_DESKTOP_CONFIG_PATHS: Record<string, string> = {
  darwin: path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  win32: path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  linux: path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
};

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

function installToClaudeDesktop(accessKey: string, accessSecret: string): void {
  const configPath = CLAUDE_DESKTOP_CONFIG_PATHS[process.platform] ?? CLAUDE_DESKTOP_CONFIG_PATHS.linux;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // Config doesn't exist yet — create it fresh
    mkdirSync(path.dirname(configPath), { recursive: true });
  }

  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};
  mcpServers.gong = {
    command: "node",
    args: [SERVER_PATH],
    env: {
      GONG_ACCESS_KEY: accessKey,
      GONG_ACCESS_KEY_SECRET: accessSecret,
    },
  };
  config.mcpServers = mcpServers;

  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ── Prompts ───────────────────────────────────────────────────────────────────

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

const targets = await multiselect({
  message: "Where should this MCP be installed?",
  options: [
    { value: "desktop", label: "Claude Desktop", hint: "Connectors tab — requires app restart" },
    { value: "code", label: "Claude Code", hint: "CLI and IDE extension" },
  ],
  initialValues: ["desktop", "code"],
});
if (isCancel(targets)) { cancel("Setup cancelled."); process.exit(0); }

const selectedTargets = targets as string[];
const errors: string[] = [];

// ── Claude Desktop ─────────────────────────────────────────────────────────

if (selectedTargets.includes("desktop")) {
  s.start("Installing to Claude Desktop…");
  try {
    installToClaudeDesktop(String(accessKey), String(accessSecret));
    s.stop("Claude Desktop configured.");
  } catch (err) {
    s.stop("Claude Desktop install failed.");
    errors.push(`Desktop: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Claude Code ────────────────────────────────────────────────────────────

if (selectedTargets.includes("code")) {
  s.start("Installing to Claude Code…");
  const result = await execFileNoThrow("claude", [
    "mcp", "add", "gong",
    "node", SERVER_PATH,
    "-e", `GONG_ACCESS_KEY=${String(accessKey)}`,
    "-e", `GONG_ACCESS_KEY_SECRET=${String(accessSecret)}`,
    "--scope", "user",
  ]);

  if (result.status === "error") {
    s.stop("Claude Code install failed.");
    errors.push(`Code: ${result.stderr || "unknown error"}`);
  } else {
    s.stop("Claude Code configured.");
  }
}

// ── Result ─────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  errors.forEach((e) => log.error(e));
}

const installed = selectedTargets.filter(
  (t) => !errors.some((e) => e.startsWith(t === "desktop" ? "Desktop" : "Code"))
);

if (installed.length === 0) {
  log.error("Installation failed. Add the MCP manually — see the README for config details.");
  process.exit(1);
}

const restartNeeded = installed.includes("desktop");
outro(
  restartNeeded
    ? "Done! Restart Claude Desktop to see Gong in the Connectors tab."
    : "Done! Restart Claude to pick up the Gong MCP tools."
);
