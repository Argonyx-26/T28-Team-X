"use client";

import { useParams } from "next/navigation";

import { Pile } from "./_pile/pile";

export default function PilePage() {
  const { code } = useParams<{ code: string }>();
  return <Pile code={decodeURIComponent(code)} />;
}
