import { HostApp } from "@/components/HostApp";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostApp code={code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)} />;
}
