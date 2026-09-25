"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { Student } from "./_student/student";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  return (
    <Suspense>
      <Student code={decodeURIComponent(code)} />
    </Suspense>
  );
}
