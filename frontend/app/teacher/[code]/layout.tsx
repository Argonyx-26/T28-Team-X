import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return { title: `Class ${decodeURIComponent(code).toUpperCase()} dashboard` };
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
