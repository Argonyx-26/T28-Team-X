"use client";

import { useParams } from "next/navigation";

import { School } from "./_school/school";

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  return <School id={decodeURIComponent(id)} />;
}
