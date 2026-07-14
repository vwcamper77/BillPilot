"use client";

export default function InternalAnalyticsBanner({ active }) {
  if (!active) return null;
  return <div className="internal-analytics-banner" role="status">Internal testing — analytics suppressed</div>;
}
