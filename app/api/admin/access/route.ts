import { ACCOUNTS, MIN_PASSWORD_LENGTH, parsePermissions } from "@/lib/admin-access";
import {
  getMember,
  getRequestViewer,
  hashPassword,
  saveMember,
  type MemberRecord,
} from "@/lib/admin-auth";

// The owner manages the member account from here. proxy.ts already keeps
// the member out (this route isn't mapped to a section), and it's checked
// again here since this is the route that hands out access.

const summary = (member: MemberRecord) => ({
  email: ACCOUNTS.member,
  hasPassword: !!member.passwordHash,
  permissions: member.permissions,
});

async function ownerOnly() {
  const viewer = await getRequestViewer();
  return viewer?.role === "owner"
    ? null
    : Response.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET() {
  const denied = await ownerOnly();
  if (denied) return denied;
  return Response.json(summary(await getMember()));
}

// Body: { permissions?, password?, revoke? }. Setting a password or revoking
// signs the member out of every device.
export async function PUT(request: Request) {
  const denied = await ownerOnly();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const member = await getMember();

  if (body.permissions !== undefined) {
    const permissions = parsePermissions(body.permissions);
    if (!permissions) return Response.json({ error: "Invalid permissions" }, { status: 400 });
    member.permissions = permissions;
  }

  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD_LENGTH) {
      return Response.json(
        { error: `The password needs at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 },
      );
    }
    member.passwordHash = await hashPassword(body.password);
    member.sessionVersion += 1;
  } else if (body.revoke === true) {
    member.passwordHash = null;
    member.sessionVersion += 1;
  }

  await saveMember(member);
  return Response.json(summary(member));
}
