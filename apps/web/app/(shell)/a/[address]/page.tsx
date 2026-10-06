import { Suspense } from "react";
import { AccountLookup } from "./account-lookup";

export default function AccountPage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <Suspense fallback={<main className="stage"><p>Reading the account.</p></main>}>
      <AccountLookup params={params} />
    </Suspense>
  );
}
