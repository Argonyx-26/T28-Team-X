import type { Metadata } from "next";

import { Present } from "./_present/present";

export const metadata: Metadata = { title: "Presenter", robots: { index: false, follow: false } };

export default function PresentPage() {
  return <Present />;
}
