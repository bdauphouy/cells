import { authenticate, setSessionCookie } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));

  const session =
    typeof email === "string" && typeof password === "string"
      ? await authenticate(email, password)
      : null;
  if (!session) {
    return Response.json({ error: "Wrong email or password" }, { status: 401 });
  }

  await setSessionCookie(session);
  return Response.json({ ok: true });
}
