import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata = { title: "Interface" };

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
