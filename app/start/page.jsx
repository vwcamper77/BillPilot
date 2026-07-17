import { Suspense } from "react";
import AuthJourney from "@/app/components/AuthJourney";

export const metadata = {
  title: "Create your ClearTill account",
  description: "Save your first ClearTill position securely. No bank connection and no card required.",
  alternates: { canonical: "/start" },
};

export default function StartPage() {
  return <Suspense fallback={<main className="acquisition-shell" aria-busy="true" />}><AuthJourney mode="signup" /></Suspense>;
}
