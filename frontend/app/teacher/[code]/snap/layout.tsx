import type { Metadata } from "next";

export const metadata: Metadata = { title: "Snap notebooks" };

export default function SnapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
