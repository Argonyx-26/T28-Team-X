import { FLAGS } from "@/lib/flags";

import { Snap } from "./_snap/snap";

// A server component on purpose: FLAGS reads process.env with a computed key, which Next inlines for the browser
// only when the variable is named literally, so the flag is decided here and handed to the client screen as a prop.
export default async function SnapPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Snap code={decodeURIComponent(code)} enabled={FLAGS.SNAP} />;
}
