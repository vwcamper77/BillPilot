"use client";
import Link from "next/link";
import { trackGa4Event } from "@/lib/analytics/ga4";

export default function DashboardLink() {
  return <Link className="primary-link billing-success-primary" href="/dashboard" onClick={() => trackGa4Event("dashboard_entered")}>Go to dashboard</Link>;
}
