import { ContractExactBadge } from "./ui/contract-exact-badge";

export function ExactBadge({ calibrated }: { calibrated: boolean }) {
  return <ContractExactBadge calibrated={calibrated} />;
}
