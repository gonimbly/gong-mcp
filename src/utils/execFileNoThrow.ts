import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: "ok" | "error";
}

export async function execFileNoThrow(
  command: string,
  args: string[]
): Promise<ExecResult> {
  // On Windows, commands like 'claude' are .cmd files and need shell: true
  const isWindows = process.platform === "win32";
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      shell: isWindows,
    });
    return { stdout, stderr, status: "ok" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
      status: "error",
    };
  }
}
