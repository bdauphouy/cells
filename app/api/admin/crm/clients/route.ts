import { createClient, parseClient } from "@/lib/crm";
import type { ClientInput } from "@/lib/crm-model";

export async function POST(request: Request) {
  const parsed = parseClient(await request.json().catch(() => null), false);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const client = await createClient(parsed.value as ClientInput);
  return Response.json({ client });
}
