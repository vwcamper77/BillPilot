import { NextResponse } from "next/server";
import {
  buildReminderMessage,
  calculateBillSchedule,
  getReminderDocumentId,
  getTodayIso,
} from "@/lib/billMath";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const todayIso = getTodayIso();
  const billsSnapshot = await db
    .collectionGroup("bills")
    .where("active", "==", true)
    .get();
  const billsByUser = new Map();

  billsSnapshot.forEach((billDoc) => {
    const userRef = billDoc.ref.parent.parent;

    if (!userRef) {
      return;
    }

    const userId = userRef.id;
    const existing = billsByUser.get(userId) || { userRef, bills: [] };

    existing.bills.push({
      id: billDoc.id,
      ref: billDoc.ref,
      ...billDoc.data(),
    });

    billsByUser.set(userId, existing);
  });

  let created = 0;

  for (const { userRef, bills } of billsByUser.values()) {
    const incomeSnapshot = await userRef.collection("income").doc("main").get();
    const income = incomeSnapshot.exists ? incomeSnapshot.data() : null;

    for (const bill of bills) {
      if (!bill.dueDay) {
        continue;
      }

      const schedule = calculateBillSchedule(
        bill.dueDay,
        bill.reminderOffsetDays || 1,
        todayIso,
      );

      if (bill.nextDueDate !== schedule.nextDueDate || bill.reminderDate !== schedule.reminderDate) {
        await bill.ref.update({
          nextDueDate: schedule.nextDueDate,
          reminderDate: schedule.reminderDate,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      if (schedule.reminderDate !== todayIso) {
        continue;
      }

      const reminderRef = userRef
        .collection("reminders")
        .doc(getReminderDocumentId(bill.id, schedule.reminderDate));
      const existingReminder = await reminderRef.get();

      if (existingReminder.exists) {
        continue;
      }

      const scheduledBill = {
        ...bill,
        ...schedule,
      };
      const message = buildReminderMessage(scheduledBill, bills, income, todayIso);

      await reminderRef.set({
        billId: bill.id,
        billName: bill.name,
        amount: Number(bill.amount) || 0,
        dueDate: schedule.nextDueDate,
        reminderDate: schedule.reminderDate,
        message,
        status: "created",
        createdAt: FieldValue.serverTimestamp(),
        sentAt: null,
      });

      await bill.ref.update({
        lastReminderSentAt: FieldValue.serverTimestamp(),
        lastReminderDate: schedule.reminderDate,
        updatedAt: FieldValue.serverTimestamp(),
      });

      created += 1;
    }
  }

  return NextResponse.json({ ok: true, created });
}

export async function POST(request) {
  return GET(request);
}

function isCronRequest(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
