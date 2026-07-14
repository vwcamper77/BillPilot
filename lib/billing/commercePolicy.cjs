const SENSITIVE_KEY = /amount(?!paid)|balance|bill|payday|email|spoken|salary|income|bank/i;

function classifyOneOff(session = {}) {
  const amount = Number(session.amount_total);
  const currency = String(session.currency || "").toLowerCase();
  return {
    paid: session.status === "complete" && session.payment_status === "paid" && amount > 0 && currency === "gbp",
    amount,
    currency,
    transactionId: String(session.payment_intent || session.id || ""),
  };
}

function classifyInvoice(invoice = {}, priorPositiveInvoices = 0) {
  const amount = Number(invoice.amount_paid);
  const currency = String(invoice.currency || "").toLowerCase();
  const paid = invoice.status === "paid" && amount > 0 && currency === "gbp" && Boolean(invoice.id);
  return { paid, amount, currency, transactionId: String(invoice.id || ""), stage: priorPositiveInvoices > 0 ? "renewal_invoice_paid" : "first_invoice_paid" };
}

function containsSensitiveFields(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY.test(key) || (child && typeof child === "object" && containsSensitiveFields(child)));
}

module.exports = { classifyOneOff, classifyInvoice, containsSensitiveFields };
