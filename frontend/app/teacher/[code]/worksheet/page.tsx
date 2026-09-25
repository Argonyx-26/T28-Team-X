"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Sheet } from "./_sheet/sheet";

function WorksheetPage() {
  const { code } = useParams<{ code: string }>();
  const q = useSearchParams();
  return <Sheet code={decodeURIComponent(code)} concept={q.get("concept") ?? ""} tag={q.get("tag") ?? ""} />;
}

export default function Page() {
  return (
    <Suspense>
      <WorksheetPage />
    </Suspense>
  );
}
