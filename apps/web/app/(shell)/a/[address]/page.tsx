export default async function AccountPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <main className="stage">
      <h1>Account</h1>
      <p className="lede">Risk for {address}. The dry run uses a 4% trigger and a 6% target.</p>
    </main>
  );
}
