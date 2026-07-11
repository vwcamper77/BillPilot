import { buildFourWeekCashflowWaterfall, diffDays, formatCurrency, formatDisplayDate } from "@/lib/billMath";

function niceAxisStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  const niceResidual = residual < 2 ? 1 : residual < 5 ? 2 : 5;
  return niceResidual * magnitude;
}

export default function FourWeekChart({ dashboard, dueBeforePaydayLargeCosts, dailySpendingRoom, minimumProjectedBalance = null, hasBalanceSnapshot, todayIso, displayCurrency, incomeAmount = 0, additionalIncomeEvents = [] }) {
  const { currentBalance, paydayDate, beforePayday, afterPayday, leftBeforePayday } = dashboard;

  if (!paydayDate || !hasBalanceSnapshot) return null;

  // Explicit waterfall points: openingBalance -> weeklyOutflow -> closingBalance per week,
  // on Monday-aligned week buckets. The pay amount lands in the week containing the pay
  // date, so weeks after payday show money coming back in rather than staying flat.
  // The forecast continues through the whole displayed four-week window. Bills
  // due after payday must therefore remain in the waterfall (including bills
  // later in the same week as payday), even though the dashboard groups them
  // separately in the bill list.
  const chartBills = [...(beforePayday || []), ...(afterPayday || [])];
  const waterfall = buildFourWeekCashflowWaterfall(todayIso, paydayDate, currentBalance, chartBills, dueBeforePaydayLargeCosts, incomeAmount, additionalIncomeEvents);
  const payDateBucketIndex = waterfall.findIndex((point) => point.containsPayDate);

  const closingBalances = waterfall.map((point) => point.closingBalance);
  // A week containing payday closes with its post-payday balance, which is
  // never the low point before payday — use its pre-payday checkpoint instead
  // so "after bills and plans" reflects every bill due before payday, not a
  // balance already boosted by income that hasn't arrived yet.
  const prePaydayBalances = waterfall
    .filter((point) => !point.isAfterPayCycle)
    .map((point) => (point.containsPayDate ? point.prePaydayClosingBalance : point.closingBalance))
    .filter((value) => Number.isFinite(value));
  const lowestBal = Math.min(
    leftBeforePayday,
    ...prePaydayBalances,
    Number.isFinite(Number(minimumProjectedBalance)) ? Number(minimumProjectedBalance) : Number.POSITIVE_INFINITY,
  );
  const goesNegative = lowestBal < 0;

  // SVG layout
  const W = 400, H = 158;
  const PL = 34, PR = 10, PT = 30, PB = 40;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const plotBottomY = PT + chartH;
  const numBars = 4;
  const barGap = 10;
  const barW = (chartW - (numBars - 1) * barGap) / numBars;

  // One shared Y scale across all 4 bars — including negative dips — not normalised per bar
  const maxCash = Math.max(currentBalance, ...closingBalances, 1);
  const minCash = Math.min(0, ...closingBalances);
  const cashRange = Math.max(maxCash - minCash, 1);
  const toY = (value) => plotBottomY - ((value - minCash) / cashRange) * chartH;
  const zeroY = toY(0);
  const toBarX = (i) => PL + i * (barW + barGap);
  const toBarCenterX = (i) => toBarX(i) + barW / 2;
  const dayOffsetX = (isoDate, bucketIndex) => {
    const offsetDays = Math.min(6, Math.max(0, diffDays(waterfall[bucketIndex].weekStart, isoDate)));
    return toBarX(bucketIndex) + (offsetDays / 6) * barW;
  };
  const anchorForX = (x) => {
    if (x - PL < 20) return "start";
    if (PL + chartW - x < 20) return "end";
    return "middle";
  };

  const referenceValue = niceAxisStep(maxCash / 2);
  const referenceY = toY(referenceValue);
  const sym = displayCurrency === "EUR" ? "€" : displayCurrency === "USD" ? "$" : "£";

  const todayX = dayOffsetX(todayIso, 0);
  // The payday week is drawn as two half-width bars (pre/post payday) rather
  // than one continuous timeline, so the marker sits at the visual gap between
  // them instead of a day-proportional offset that wouldn't line up with it.
  const paydayX = payDateBucketIndex !== -1 ? toBarCenterX(payDateBucketIndex) : null;
  const paydaySharesWeekWithToday = payDateBucketIndex === 0;

  return (
    <section className="spend-curve-card">
      <h2 className="spend-curve-title">Your next 4 weeks</h2>
      <div className="spend-curve-summary">
        <span className="curve-stat">
          <span className="curve-stat-label">Today</span>
          <strong>{formatCurrency(currentBalance, displayCurrency)}</strong>
        </span>
        <span className="curve-stat">
          <span className="curve-stat-label">After bills and plans</span>
          <strong className={goesNegative ? "curve-negative" : ""}>{formatCurrency(lowestBal, displayCurrency)}</strong>
        </span>
        {dailySpendingRoom !== null && !goesNegative ? (
          <span className="curve-stat">
            <span className="curve-stat-label">Safe daily</span>
            <strong>{formatCurrency(dailySpendingRoom, displayCurrency)}/day</strong>
          </span>
        ) : null}
        <span className="curve-stat">
          <span className="curve-stat-label">Payday</span>
          <strong>{formatDisplayDate(paydayDate)}</strong>
        </span>
      </div>
      {goesNegative ? (
        <p className="spend-curve-warning">You may go below £0 before payday.</p>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="spend-curve-svg" role="img" aria-label="Your next 4 weeks until pay day">
        {/* Reference gridline, scaled to this week's net cash range */}
        {referenceY > PT && referenceY < zeroY ? (
          <>
            <line x1={PL} y1={referenceY} x2={PL + chartW} y2={referenceY} stroke="var(--line)" strokeWidth="0.8" strokeDasharray="3 3" />
            <text x={PL - 4} y={referenceY + 3.5} textAnchor="end" fontSize="9" fill="var(--muted)">{sym}{referenceValue}</text>
          </>
        ) : null}
        {/* Bars: grounded at £0 — positive balances rise above the line, negative balances hang below it */}
        {waterfall.map((point, i) => {
          const scaledH = (Math.abs(point.closingBalance) / cashRange) * chartH;
          const bh = Math.max(scaledH, 2);
          const negative = point.closingBalance < 0;
          const barTopY = negative ? zeroY : zeroY - bh;
          const muted = point.isAfterPayCycle;
          const labelFitsInside = bh >= 16;
          const labelY = labelFitsInside ? barTopY + 13 : barTopY - 5;
          const isSplitWeek = point.containsPayDate && Number.isFinite(point.prePaydayClosingBalance);

          // The payday week renders as two clearly separate bars — before
          // payday and after payday — connected by a step line, instead of one
          // flat bar that hides the mid-week jump. The original single bar is
          // still drawn beneath (invisible) so its data attributes stay intact.
          let splitBars = null;
          if (isSplitWeek) {
            const halfGap = 4;
            const halfW = (barW - halfGap) / 2;
            const preX = toBarX(i);
            const postX = preX + halfW + halfGap;

            const renderHalf = (value, x, segment) => {
              const segNegative = value < 0;
              const segScaledH = (Math.abs(value) / cashRange) * chartH;
              const segBh = Math.max(segScaledH, 2);
              const segTopY = segNegative ? zeroY : zeroY - segBh;
              const segLabelFits = segBh >= 16;
              const segLabelY = segLabelFits ? segTopY + 12 : segTopY - 5;
              return {
                topY: segTopY,
                node: (
                  <g key={segment}>
                    <rect
                      data-testid={`waterfall-bar-${segment}-payday`}
                      data-week-index={i}
                      data-value={value}
                      x={x.toFixed(1)}
                      y={segTopY.toFixed(1)}
                      width={halfW.toFixed(1)}
                      height={segBh.toFixed(1)}
                      fill={segNegative ? "var(--warn)" : segment === "pre" ? "var(--accent-dark)" : "var(--accent)"}
                      opacity={0.85}
                      rx="2.5"
                    />
                    <text
                      data-testid={`waterfall-bar-${segment}-payday-label`}
                      data-week-index={i}
                      x={(x + halfW / 2).toFixed(1)}
                      y={segLabelY.toFixed(1)}
                      textAnchor="middle"
                      fontSize="8"
                      fontWeight="600"
                      fill={segLabelFits ? "#ffffff" : "var(--ink)"}
                    >
                      {formatCurrency(value, displayCurrency)}
                    </text>
                  </g>
                ),
              };
            };

            const pre = renderHalf(point.prePaydayClosingBalance, preX, "pre");
            const post = renderHalf(point.closingBalance, postX, "post");
            splitBars = (
              <>
                {pre.node}
                <path
                  data-testid="waterfall-bar-step-connector"
                  data-week-index={i}
                  d={`M ${(preX + halfW).toFixed(1)} ${pre.topY.toFixed(1)} H ${(preX + halfW + halfGap / 2).toFixed(1)} V ${post.topY.toFixed(1)} H ${postX.toFixed(1)}`}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  opacity="0.45"
                />
                {post.node}
              </>
            );
          }

          return (
            <g key={point.weekStart}>
              <rect
                data-testid="waterfall-bar"
                data-week-index={i}
                data-week-start={point.weekStart}
                data-opening-balance={point.openingBalance}
                data-closing-balance={point.closingBalance}
                data-weekly-outflow={point.weeklyOutflow}
                data-muted={muted}
                x={toBarX(i).toFixed(1)}
                y={barTopY.toFixed(1)}
                width={barW.toFixed(1)}
                height={bh.toFixed(1)}
                fill={negative ? "var(--warn)" : "var(--accent)"}
                opacity={muted ? 0.18 : isSplitWeek ? 0 : 0.78}
                rx="3"
              />
              {splitBars}
              {!isSplitWeek ? (
                <text
                  data-testid="waterfall-bar-label"
                  data-week-index={i}
                  x={toBarCenterX(i).toFixed(1)}
                  y={labelY.toFixed(1)}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="600"
                  fill={labelFitsInside ? "#ffffff" : "var(--ink)"}
                  opacity={muted ? 0.6 : 1}
                >
                  {formatCurrency(point.closingBalance, displayCurrency)}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* £0 line — floats up from the bottom once a week dips negative */}
        <line data-testid="zero-line" x1={PL} y1={zeroY.toFixed(1)} x2={PL + chartW} y2={zeroY.toFixed(1)} stroke="var(--line)" strokeWidth="1" />
        {minCash < 0 ? (
          <text x={PL - 4} y={(zeroY + 3.5).toFixed(1)} textAnchor="end" fontSize="9" fill="var(--muted)">{sym}0</text>
        ) : null}
        {/* Weekly outgoing and money coming in (payday) under each column */}
        {waterfall.map((point, i) => {
          const hasOutflow = point.weeklyOutflow > 0;
          const hasIncome = point.incomeReceived > 0;
          if (!hasOutflow && !hasIncome) return null;
          const bothPresent = hasOutflow && hasIncome;
          const outflowX = bothPresent ? toBarX(i) + barW * 0.27 : toBarCenterX(i);
          const incomeX = bothPresent ? toBarX(i) + barW * 0.73 : toBarCenterX(i);
          return (
            <g key={point.weekStart}>
              {hasOutflow ? (
                <text
                  data-testid="weekly-outflow"
                  data-week-index={i}
                  data-amount={point.weeklyOutflow}
                  x={outflowX.toFixed(1)}
                  y={plotBottomY + 13}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="600"
                  fill="var(--warn)"
                  opacity={point.isAfterPayCycle ? 0.5 : 0.85}
                >
                  -{formatCurrency(point.weeklyOutflow, displayCurrency)}
                </text>
              ) : null}
              {hasIncome ? (
                <text
                  data-testid="weekly-income"
                  data-week-index={i}
                  data-amount={point.incomeReceived}
                  x={incomeX.toFixed(1)}
                  y={plotBottomY + 13}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="600"
                  fill="var(--accent-dark)"
                >
                  +{formatCurrency(point.incomeReceived, displayCurrency)}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Week commencing labels */}
        {waterfall.map((point, i) => (
          <text
            data-testid="week-label"
            data-week-index={i}
            key={point.weekStart}
            x={toBarCenterX(i).toFixed(1)}
            y={H - 6}
            textAnchor="middle"
            fontSize="8.5"
            fill="var(--muted)"
            opacity={point.isAfterPayCycle ? 0.55 : 1}
          >
            {point.weekLabel}
          </text>
        ))}
        {/* Today marker */}
        <g data-testid="today-marker">
          <line x1={todayX.toFixed(1)} y1={PT} x2={todayX.toFixed(1)} y2={plotBottomY} stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 3" opacity="0.55" />
          <circle cx={todayX.toFixed(1)} cy={PT} r="2.2" fill="var(--ink)" />
          <text x={todayX.toFixed(1)} y={PT - 8} textAnchor={anchorForX(todayX)} fontSize="9" fontWeight="600" fill="var(--ink)">
            Today
          </text>
        </g>
        {/* Pay date marker */}
        {paydayX !== null ? (
          <g data-testid="payday-marker" data-week-index={payDateBucketIndex}>
            <line
              x1={paydayX.toFixed(1)}
              y1={PT}
              x2={paydayX.toFixed(1)}
              y2={plotBottomY}
              stroke="var(--accent-dark)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <circle cx={paydayX.toFixed(1)} cy={PT} r="2.2" fill="var(--accent-dark)" />
            <text
              x={paydayX.toFixed(1)}
              y={paydaySharesWeekWithToday ? plotBottomY - 6 : PT - 8}
              textAnchor={anchorForX(paydayX)}
              fontSize="9"
              fontWeight="600"
              fill="var(--accent-dark)"
            >
              {waterfall[payDateBucketIndex].payDateLabel}
            </text>
          </g>
        ) : null}
      </svg>
      {waterfall.some((point) => point.additionalIncomeReceived > 0) ? (
        <div className="forecast-income-notes" data-testid="forecast-income-notes">
          {waterfall.flatMap((point) => point.incomeBreakdown)
            .filter((item) => item.type === "additional_income")
            .map((item) => (
              <span key={`${item.name}-${item.date}`}>{item.name}: +{formatCurrency(item.amount, displayCurrency)} on {formatDisplayDate(item.date)}</span>
            ))}
        </div>
      ) : null}
      {payDateBucketIndex !== -1 && waterfall[payDateBucketIndex].steps.length > 0 ? (
        <div className="payday-week-bridge" data-testid="payday-week-bridge">
          <span data-testid="payday-week-bridge-step" data-step="opening">
            {formatDisplayDate(waterfall[payDateBucketIndex].weekStart)}: {formatCurrency(waterfall[payDateBucketIndex].openingBalance, displayCurrency)}
          </span>
          {waterfall[payDateBucketIndex].steps.map((step) => (
            <span
              key={`${step.type}-${step.date}-${step.name}`}
              data-testid="payday-week-bridge-step"
              data-step={step.type}
              data-date={step.date}
              data-balance-after={step.balanceAfter}
            >
              {step.name}: {step.amount >= 0 ? "+" : "-"}{formatCurrency(Math.abs(step.amount), displayCurrency)} on {formatDisplayDate(step.date)} → {formatCurrency(step.balanceAfter, displayCurrency)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
