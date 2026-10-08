"use client";

import { PracticeHost, offlineClient } from "../lifeline/try-lifeline";
import { ProtectBoard } from "./protect-board";

export function ProtectApp() {
  return (
    <PracticeHost fallback={<ProtectBoard client={offlineClient} />}>
      {(client) => <ProtectBoard client={client} />}
    </PracticeHost>
  );
}
