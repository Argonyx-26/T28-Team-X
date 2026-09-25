export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code;
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold font-heading">Scan for {code}</h1>
      <p className="text-muted-foreground">Scan Page Shell</p>
    </main>
  );
}
