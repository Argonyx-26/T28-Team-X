import type { Metadata } from "next";

export const metadata: Metadata = { title: "Read a pile of notebooks" };

export default function PileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
