import Stripe from "stripe";
import { getBillingRuntimeConfig } from "@/lib/billing/config";

let stripeClient = null;

export function getStripeClient() {
  const runtime = getBillingRuntimeConfig();
  if (!runtime.ok) {
    const error = new Error(runtime.message);
    error.code = runtime.code;
    throw error;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-06-30.basil",
    });
  }

  return stripeClient;
}
