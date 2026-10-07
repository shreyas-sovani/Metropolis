import type { Metadata } from "next";
import { CHECK_SUB } from "../../../lib/report";
import { CheckForm } from "./check-form";

export const metadata: Metadata = {
  title: "Check an address",
  description: CHECK_SUB,
};

export default function CheckPage() {
  return <CheckForm />;
}
