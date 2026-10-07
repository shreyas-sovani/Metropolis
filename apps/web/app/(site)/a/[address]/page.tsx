import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "../../../ui/skeleton";
import { AccountLookup } from "./account-lookup";
import "./report.css";

export const metadata: Metadata = {
  title: "Risk report",
  description: "How close each position is to liquidation, and what Lifeline would do right now.",
};

export default function AccountPage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <Suspense fallback={<ReportFallback />}>
      <AccountLookup params={params} />
    </Suspense>
  );
}

function ReportFallback() {
  return (
    <div className="ui-scope">
      <main className="container report-page">
        <h1>Risk report</h1>
        <div className="report-list" aria-busy="true">
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      </main>
    </div>
  );
}
