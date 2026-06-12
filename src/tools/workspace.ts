import type { GongClient } from "../gong/client.js";

export interface WorkspaceRef {
  id: string;
  name?: string;
}

interface WorkspacesResponse {
  workspaces?: Array<{ id?: string | number; name?: string }>;
}

export async function listWorkspaceRefs(client: GongClient): Promise<WorkspaceRef[]> {
  const { workspaces } = await client.listWorkspaces() as WorkspacesResponse;
  return (workspaces ?? [])
    .filter((w) => w.id != null)
    .map((w) => ({ id: String(w.id), name: w.name }));
}

/** Resolve the workspace when the caller didn't pass one: unambiguous for a
 * single-workspace org, otherwise an error that lists the real choices so the
 * model can self-correct in one step. */
export async function defaultWorkspaceId(client: GongClient): Promise<string> {
  const all = await listWorkspaceRefs(client);
  if (all.length === 1) return all[0].id;
  const list = all.map((w) => `"${w.name}"=${w.id}`).join(", ");
  throw new Error(`workspaceId is required — this org has ${all.length} workspaces: ${list}`);
}
