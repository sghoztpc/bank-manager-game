import { PlayerApp } from "@/components/PlayerApp";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerApp code={code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)} />;
}
