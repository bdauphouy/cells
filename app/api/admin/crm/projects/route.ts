import { createClient, createProject, getClient, parseProject } from "@/lib/crm";
import type { Client, ProjectInput } from "@/lib/crm-model";

// `newClientName` lets the project form create its client in the same step,
// instead of sending the admin off to the clients list first.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const newClientName =
    typeof body?.newClientName === "string" ? body.newClientName.trim().slice(0, 200) : "";

  const parsed = parseProject(newClientName ? { ...body, clientId: "pending" } : body, false);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  let client: Client | null = null;
  if (newClientName) {
    client = await createClient({ name: newClientName, email: "", phone: "", social: "", notes: "" });
    parsed.value.clientId = client.id;
  } else if (!(await getClient(parsed.value.clientId!))) {
    return Response.json({ error: "Unknown client" }, { status: 400 });
  }

  const project = await createProject(parsed.value as ProjectInput);
  return Response.json({ project, client });
}
