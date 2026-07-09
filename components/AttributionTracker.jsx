"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureAttributionIfFirstTouch } from "@/lib/analytics/attribution";
import { trackEvent } from "@/lib/analytics/track";

function AttributionTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasFiredLandingView = useRef(false);

  useEffect(() => {
    const { isFirstTouch } = captureAttributionIfFirstTouch();

    if (isFirstTouch && !hasFiredLandingView.current) {
      hasFiredLandingView.current = true;
      trackEvent("landing_page_view", { pathname });
    }
    // Only re-run on navigation, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}

export default function AttributionTracker() {
  return (
    <Suspense fallback={null}>
      <AttributionTrackerInner />
    </Suspense>
  );
}
