import { getApps } from "firebase-admin/app";
import { NextResponse } from "next/server";
import {
  calculateBillSchedule,
  calculateIncomeSchedule,
  formatGBP,
  getReminderDocumentId,
  getTodayIso,
  isValidDueDay,
} from "@/lib/billMath";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request) {
  return handleRemindersRequest(request);
}

export async function POST(request) {
  return handleRemindersRequest(request);
}

async function handleRemindersRequest(request) {
  console.log("[reminders] start");

  if (!isCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[reminders] admin project", process.env.FIREBASE_PROJECT_ID);
    const db = getAdminDb();
    const adminApp = getApps()[0] || null;
    console.log("[reminders] admin initialized", Boolean(adminApp));

    const todayIso = getTodayIso();
    const tomorrowIso = getTodayIso(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const requestedUid = getRequestedUid(request);
    const usersToProcess = await loadUsersToProcess(db, requestedUid);

    const summary = {
      ok: true,
      processedUsers: 0,
      billsChecked: 0,
      remindersCreated: 0,
      duplicatesSkipped: 0,
      invalidBillsSkipped: 0,
    };

    for (const { uid, userRef, bills } of usersToProcess) {
      console.log("[reminders] processing uid", uid);
      console.log("[reminders] bills found", bills.length);

      summary.processedUsers += 1;
      summary.billsChecked += bills.length;

      const [incomeSnapshot, balanceSnapshot] = await Promise.all([
        userRef.collection("income").doc("main").get(),
        userRef.collection("settings").doc("balance").get(),
      ]);

      const income = incomeSnapshot.exists ? incomeSnapshot.data() : null;
      const balance = balanceSnapshot.exists ? balanceSnapshot.data() : null;

      for (const bill of bills) {
        if (!isValidDueDay(bill.dueDay)) {
          summary.invalidBillsSkipped += 1;
          continue;
        }

        const schedule = calculateBillSchedule(bill.dueDay, 1, bill.paidThroughDate || null, todayIso);

        if (bill.nextDueDate !== schedule.nextDueDate || bill.reminderDate !== schedule.reminderDate) {
          await bill.ref.update({
            nextDueDate: schedule.nextDueDate,
            reminderDate: schedule.reminderDate,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        if (schedule.nextDueDate !== tomorrowIso || schedule.reminderDate !== todayIso) {
          continue;
        }

        console.log("[reminders] due tomorrow", bill.name, bill.id);

        const reminderId = getReminderDocumentId(bill.id, schedule.reminderDate);
        const reminderRef = userRef.collection("reminders").doc(reminderId);
        const existingReminder = await reminderRef.get();

        if (existingReminder.exists) {
          console.log("[reminders] skipped duplicate", reminderId);
          summary.duplicatesSkipped += 1;
          continue;
        }

        const scheduledBill = {
          ...bill,
          ...schedule,
        };
        const message = buildInAppReminderMessage({
          bill: scheduledBill,
          allBills: bills,
          income,
          balance,
          todayIso,
        });

        await reminderRef.set({
          billId: bill.id,
          billName: bill.name,
          amount: Number(bill.amount) || 0,
          dueDate: schedule.nextDueDate,
          dueDay: Number(bill.dueDay),
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

        console.log("[reminders] created", reminderId);
        summary.remindersCreated += 1;
      }
    }

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("[reminders] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Unknown reminder error" },
      { status: 500 },
    );
  }
}

function isCronRequest(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function getRequestedUid(request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (process.env.NODE_ENV !== "production" && uid) {
    return uid.trim();
  }

  return "";
}

async function loadUsersToProcess(db, requestedUid) {
  if (requestedUid) {
    const userRef = db.collection("users").doc(requestedUid);
    const billsSnapshot = await userRef
      .collection("bills")
      .where("active", "==", true)
      .get();

    return [{
      uid: requestedUid,
      userRef,
      bills: billsSnapshot.docs.map((billDoc) => ({
        id: billDoc.id,
        ref: billDoc.ref,
        ...billDoc.data(),
      })),
    }];
  }

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

    const uid = userRef.id;
    const existing = billsByUser.get(uid) || { uid, userRef, bills: [] };

    existing.bills.push({
      id: billDoc.id,
      ref: billDoc.ref,
      ...billDoc.data(),
    });

    billsByUser.set(uid, existing);
  });

  return [...billsByUser.values()];
}

function buildInAppReminderMessage({ bill, allBills, income, balance, todayIso }) {
  const base = `${bill.name} is due tomorrow — ${formatGBP(bill.amount)}.`;

  if (!isValidDueDay(income?.payDay) || !Number.isFinite(Number(balance?.currentBalance))) {
    return base;
  }

  const paydayDate = calculateIncomeSchedule(income.payDay, todayIso).nextPayDate;

  if (!paydayDate) {
    return base;
  }

  const remainingBills = allBills
    .filter((otherBill) => otherBill.active !== false && otherBill.id !== bill.id && isValidDueDay(otherBill.dueDay))
    .map((otherBill) => ({
      ...otherBill,
      ...calculateBillSchedule(otherBill.dueDay, 1, otherBill.paidThroughDate || null, todayIso),
    }))
    .filter((otherBill) => otherBill.nextDueDate && otherBill.nextDueDate < paydayDate);
  const remainingTotal = remainingBills.reduce((total, otherBill) => total + (Number(otherBill.amount) || 0), 0);

  if (remainingTotal > 0) {
    return `${base} You still have ${formatGBP(remainingTotal)} due before payday.`;
  }

  return `${base} You're then clear until payday.`;
}
