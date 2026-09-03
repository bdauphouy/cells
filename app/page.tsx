import CarouselExperience from "@/components/CarouselExperience";
import { resolveCards } from "@/lib/library";
import Image from "next/image";

// The admin page writes to Redis without redeploying, so this route can't be
// statically frozen at build time — it has to re-read on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const cards = await resolveCards();
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-brand">
      <Image
        src="/logo.svg"
        alt="Logo"
        width={140}
        height={91}
        className="pointer-events-none absolute top-4 left-4 z-10 h-10 w-auto sm:top-6 sm:left-6 sm:h-14"
        priority
      />
      <CarouselExperience cards={cards} />
    </main>
  );
}
