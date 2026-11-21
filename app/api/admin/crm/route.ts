import { getCrm } from "@/lib/crm";

export async function GET() {
  return Response.json(await getCrm());
}
