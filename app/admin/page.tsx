import { redirect } from "next/navigation";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { getRequestViewer } from "@/lib/admin-auth";

// Resolved on the server so the dashboard renders with the right sections
// from the first paint instead of flashing the owner's view. proxy.ts has
// already turned away anyone without a session; this covers a session that
// lapses between the two.
export default async function AdminPage() {
  const viewer = await getRequestViewer();
  if (!viewer) redirect("/admin/login");
  return <AdminDashboard viewer={viewer} />;
}
