"use client";

import { formatPercent, labelizeEventName } from "./format";

export default function FunnelSection({ funnel }) {
  const maxCount = funnel.reduce((max, stage) => Math.max(max, stage.count), 0) || 1;

  return (
    <div className="admin-funnel">
      {funnel.map((stage) => (
        <div className="admin-funnel-row" key={stage.stage}>
          <span className="admin-funnel-label">{labelizeEventName(stage.stage)}</span>
          <div className="admin-funnel-track" role="img" aria-label={`${stage.count} at ${labelizeEventName(stage.stage)}`}>
            <div
              className="admin-funnel-fill"
              style={{ width: `${Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 3 : 0)}%` }}
            />
          </div>
          <div className="admin-funnel-meta">
            <span className="admin-funnel-count">{stage.count}</span>
            {stage.dropOffPct != null ? (
              <span className="admin-funnel-dropoff">-{formatPercent(stage.dropOffPct)}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
