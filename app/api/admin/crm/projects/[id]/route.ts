import { createClient, deleteProject, getClient, parseProject, updateProject } from "@/lib/crm";
import type { Client } from "@/lib/crm-model";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const newClientName =
    typeof body?.newClientName === "string" ? body.newClientName.trim().slice(0, 200) : "";

  const parsed = parseProject(body, true);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  if (!newClientName && parsed.value.clientId && !(await getClient(parsed.value.clientId))) {
    return Response.json({ error: "Unknown client" }, { status: 400 });
  }

  let client: Client | null = null;
  if (newClientName) {
    client = await createClient({ name: newClientName, email: "", phone: "", social: "", notes: "" });
    parsed.value.clientId = client.id;
  }

  const project = await updateProject(id, parsed.value);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project, client });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await deleteProject(id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
