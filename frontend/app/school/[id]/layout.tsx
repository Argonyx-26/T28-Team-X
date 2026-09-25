import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `School ${decodeURIComponent(id)}` };
}

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  return children;
}
