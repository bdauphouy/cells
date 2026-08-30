import SpiralCarousel from "@/components/SpiralCarousel";
import { resolveCards } from "@/lib/library";

// The admin page writes to Redis without redeploying, so this route can't be
// statically frozen at build time — it has to re-read on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const cards = await resolveCards();
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-brand">
      <SpiralCarousel cards={cards} />
    </main>
  );
}
