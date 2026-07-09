import { test, expect } from "@playwright/test";
import { getFourWeekPayBuckets } from "../../lib/billMath.js";

// Reference calendar: Mon 2026-07-06, Mon 2026-07-13, Mon 2026-07-20, Mon 2026-07-27, Thu 2026-07-09.

test.describe("getFourWeekPayBuckets", () => {
  test("today is Monday: week 1 starts today", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-06", 500, 20);
    expect(buckets).toHaveLength(4);
    expect(buckets[0].weekStart).toBe("2026-07-06");
    expect(buckets[0].weekLabel).toBe("WC 6 Jul");
    expect(buckets[1].weekStart).toBe("2026-07-13");
    expect(buckets[2].weekStart).toBe("2026-07-20");
    expect(buckets[3].weekStart).toBe("2026-07-27");
  });

  test("today is mid-week: WC still starts on the preceding Monday", () => {
    // Thursday 9 July -> week commencing Monday 6 July
    const buckets = getFourWeekPayBuckets("2026-07-09", "2026-07-27", 500, 20);
    expect(buckets[0].weekStart).toBe("2026-07-06");
    expect(buckets[0].weekLabel).toBe("WC 6 Jul");
    expect(buckets[1].weekStart).toBe("2026-07-13");
    expect(buckets[1].weekLabel).toBe("WC 13 Jul");
    expect(buckets[2].weekStart).toBe("2026-07-20");
    expect(buckets[3].weekStart).toBe("2026-07-27");
  });

  test("pay date in week 1", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-10", 500, 20);
    expect(buckets[0].containsPayDate).toBe(true);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 2", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-15", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(true);
    expect(buckets[1].weekLabel).toBe("WC 13 Jul");
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 3", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-21", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(true);
    expect(buckets[2].weekLabel).toBe("WC 20 Jul");
    expect(buckets[3].containsPayDate).toBe(false);
  });

  test("pay date in week 4", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-28", 500, 20);
    expect(buckets[0].containsPayDate).toBe(false);
    expect(buckets[1].containsPayDate).toBe(false);
    expect(buckets[2].containsPayDate).toBe(false);
    expect(buckets[3].containsPayDate).toBe(true);
    expect(buckets[3].weekLabel).toBe("WC 27 Jul");
  });

  test("weeks after the pay date are marked as after the pay cycle and muted", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-10", 500, 20);
    expect(buckets[0].isAfterPayCycle).toBe(false);
    expect(buckets[1].isAfterPayCycle).toBe(true);
    expect(buckets[1].muted).toBe(true);
    expect(buckets[2].isAfterPayCycle).toBe(true);
    expect(buckets[3].isAfterPayCycle).toBe(true);
  });

  test("marker label uses 'Pay date', not 'Paid date'", () => {
    const buckets = getFourWeekPayBuckets("2026-07-06", "2026-07-20", 500, 20);
    const payDateBucket = buckets.find((bucket) => bucket.containsPayDate);
    expect(payDateBucket.payDateLabel).toBe("Pay date 20 Jul");
    expect(payDateBucket.payDateLabel).not.toContain("Paid date");
  });
});
