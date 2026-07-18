import { Suspense } from "react";
import AuthJourney from "@/app/components/AuthJourney";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Sign in to ClearTill",
  description: "Return to your saved ClearTill position.",
  alternates: { canonical: "/signin" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function SigninPage() {
  return <Suspense fallback={<main className="acquisition-shell" aria-busy="true" />}><AuthJourney mode="signin" /></Suspense>;
}
