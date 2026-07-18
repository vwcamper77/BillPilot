import { Suspense } from "react";
import AuthJourney from "@/app/components/AuthJourney";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Create your ClearTill account",
  description: "Save your first ClearTill position securely. No bank connection and no card required.",
  alternates: { canonical: "/start" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function StartPage() {
  return <Suspense fallback={<main className="acquisition-shell" aria-busy="true" />}><AuthJourney mode="signup" /></Suspense>;
}
