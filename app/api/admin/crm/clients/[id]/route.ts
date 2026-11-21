import { deleteClient, parseClient, updateClient } from "@/lib/crm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = parseClient(await request.json().catch(() => null), true);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const client = await updateClient(id, parsed.value);
  if (!client) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ client });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await deleteClient(id);
  if (result === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  // Refused rather than cascading, so removing a client can never silently
  // wipe out the record of what they still owe.
  if (result === "has_projects") {
    return Response.json(
      { error: "This client still has projects. Delete or reassign them first." },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}
