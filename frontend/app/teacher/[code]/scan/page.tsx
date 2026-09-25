"use client";

import { useParams } from "next/navigation";

import { Scan } from "./_scan/scan";

export default function ScanPage() {
  const { code } = useParams<{ code: string }>();
  return <Scan code={decodeURIComponent(code)} />;
}
