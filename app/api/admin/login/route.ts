import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  SESSION_SECONDS,
  checkPassword,
  createSessionCookie,
} from "@/lib/admin-auth";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: "" }));

  if (typeof password !== "string" || !checkPassword(password)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, createSessionCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });

  return Response.json({ ok: true });
}
