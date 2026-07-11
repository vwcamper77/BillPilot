"use client";
import { useEffect } from "react";
import { trackGa4Event } from "@/lib/analytics/ga4";

export default function OfferView() {
  useEffect(() => {
    trackGa4Event("view_item", { currency: "GBP", value: 5, items: [{ item_id: "founding_member_90_day", item_name: "ClearTill 90-day founding-member offer", price: 5, quantity: 1 }] });
  }, []);
  return null;
}
