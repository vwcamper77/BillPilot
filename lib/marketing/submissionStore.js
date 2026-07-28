"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

class SubmissionStore {
  constructor(filePath) { this.filePath = filePath; }
  read() {
    try { return JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return { version: 1, description: "Local idempotency ledger for provider submissions.", submissions: [] };
      throw error;
    }
  }
  find(contentId, channel, mode) {
    return this.read().submissions.find((item) => item.contentId === contentId && item.channel === channel && item.mode === mode) || null;
  }
  acquire(contentId, channel, mode) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const key = createHash("sha256").update(`${contentId}:${channel}:${mode}`).digest("hex").slice(0, 20);
    const lockPath = `${this.filePath}.${key}.lock`;
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${process.pid}\n`);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`A ${mode} submission for ${contentId} on ${channel} is already in progress.`);
      throw error;
    }
    return () => {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    };
  }
  record(entry) {
    const ledger = this.read();
    if (ledger.submissions.some((item) => item.contentId === entry.contentId && item.channel === entry.channel && item.mode === entry.mode)) {
      throw new Error(`Duplicate ${entry.mode} submission for ${entry.contentId} on ${entry.channel}.`);
    }
    ledger.submissions.push(entry);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return entry;
  }
  remove(contentId, channel, mode) {
    const ledger = this.read();
    const before = ledger.submissions.length;
    ledger.submissions = ledger.submissions.filter((item) => !(item.contentId === contentId && item.channel === channel && item.mode === mode));
    if (ledger.submissions.length === before) return false;
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return true;
  }
}

module.exports = { SubmissionStore };
