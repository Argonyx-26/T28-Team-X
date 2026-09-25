import type { Metadata } from "next";

import { NewClass } from "./_new/new-class";

export const metadata: Metadata = { title: "Create a class" };

export default function NewClassPage() {
  return <NewClass />;
}
