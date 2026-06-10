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

function installToClaudeDesktop(clientId: string, clientSecret?: string): void {
  const configPath = CLAUDE_DESKTOP_CONFIG_PATHS[process.platform] ?? CLAUDE_DESKTOP_CONFIG_PATHS.linux;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    mkdirSync(path.dirname(configPath), { recursive: true });
  }

  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};
  const env: Record<string, string> = { GONG_OAUTH_CLIENT_ID: clientId };
  if (clientSecret) env.GONG_OAUTH_CLIENT_SECRET = clientSecret;

  mcpServers.gong = {
    command: "node",
    args: [SERVER_PATH],
    env,
  };
  config.mcpServers = mcpServers;

  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ── Prompts ───────────────────────────────────────────────────────────────────

intro("  Gong MCP — Setup  ");

log.info("You need a Gong OAuth app to proceed. Create one at: Gong → Settings → API → OAuth Apps");

const clientId = await text({
  message: "OAuth Client ID",
  placeholder: "paste your OAuth client ID",
  validate: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
});
if (isCancel(clientId)) { cancel("Setup cancelled."); process.exit(0); }

const clientSecretInput = await text({
  message: "OAuth Client Secret (optional — leave blank for PKCE-only public clients)",
  placeholder: "leave blank if not required",
});
if (isCancel(clientSecretInput)) { cancel("Setup cancelled."); process.exit(0); }
const clientSecret = String(clientSecretInput).trim() || undefined;

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
const s = spinner();

// ── Claude Desktop ─────────────────────────────────────────────────────────

if (selectedTargets.includes("desktop")) {
  s.start("Installing to Claude Desktop…");
  try {
    installToClaudeDesktop(String(clientId), clientSecret);
    s.stop("Claude Desktop configured.");
  } catch (err) {
    s.stop("Claude Desktop install failed.");
    errors.push(`Desktop: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Claude Code ────────────────────────────────────────────────────────────

if (selectedTargets.includes("code")) {
  s.start("Installing to Claude Code…");
  const envArgs: string[] = [
    "-e", `GONG_OAUTH_CLIENT_ID=${String(clientId)}`,
  ];
  if (clientSecret) envArgs.push("-e", `GONG_OAUTH_CLIENT_SECRET=${clientSecret}`);

  const result = await execFileNoThrow("claude", [
    "mcp", "add", "gong",
    "node", SERVER_PATH,
    ...envArgs,
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
    ? "Done! Restart Claude Desktop, then say \"Login to Gong\" to complete OAuth authentication."
    : "Done! Open Claude and say \"Login to Gong\" to complete OAuth authentication."
);
