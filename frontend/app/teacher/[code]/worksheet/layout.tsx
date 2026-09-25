import type { Metadata } from "next";

export const metadata: Metadata = { title: "Worksheet" };

export default function WorksheetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
