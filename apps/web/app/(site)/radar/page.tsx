import type { Metadata } from "next";
import { RadarBoard } from "./radar-board";

export const metadata: Metadata = {
  title: "Market risk",
  description: "Every open Perpl position, read from the contract, with its exact liquidation price.",
};

export default function RadarPage() {
  return (
    <main>
      <RadarBoard />
    </main>
  );
}
