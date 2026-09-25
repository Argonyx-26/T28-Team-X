export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code;
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold font-heading">Join {code}</h1>
      <p className="text-muted-foreground">Student Join Shell</p>
    </main>
  );
}
