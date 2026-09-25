"use client";

import { useParams } from "next/navigation";

import { Dashboard } from "./_dashboard/dashboard";

export default function TeacherDashboardPage() {
  const { code } = useParams<{ code: string }>();
  return <Dashboard code={decodeURIComponent(code)} />;
}
