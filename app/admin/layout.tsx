import type { Metadata } from "next";

// A private dashboard behind a session cookie — nothing here should ever be
// crawled or turn up in a search result, even if a URL leaks.
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
