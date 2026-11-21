import { MIN_PASSWORD_LENGTH } from "@/lib/admin-access";
import { changeOwnPassword, getRequestViewer, setSessionCookie } from "@/lib/admin-auth";

// Any signed-in account changing its own password. Every other session of
// that account is signed out; this device gets a fresh cookie so it stays in.
export async function PUT(request: Request) {
  const viewer = await getRequestViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await request.json().catch(() => ({}));
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 },
    );
  }

  const session = await changeOwnPassword(viewer.role, currentPassword, newPassword);
  if (!session) {
    return Response.json({ error: "The current password is wrong" }, { status: 400 });
  }

  await setSessionCookie(session);
  return Response.json({ ok: true });
}
