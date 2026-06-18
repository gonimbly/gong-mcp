import { sendSlackAlert } from "../utils/alert.js";

// Gong's documented default is 10,000 requests/day (raisable by contacting Gong
// support). It is NOT discoverable via the API, so we assume the default and let
// each deployment declare its real, negotiated limit via GONG_DAILY_QUOTA.
const DEFAULT_DAILY_LIMIT = 10_000;
const ALERT_THRESHOLD = 0.75;
// Always raise the first alarm by this many requests, even if the configured
// limit is much higher — the documented default is the danger line to watch.
const WARN_FLOOR = 10_000;

class DailyQuotaTracker {
  private count = 0;
  private date = todayUTC();
  private alerted = false;

  private get limit(): number {
    const raw = process.env.GONG_DAILY_QUOTA;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
  }

  // Warn at 75% of the limit, but never later than the 10k floor.
  private get warnAt(): number {
    return Math.min(this.limit * ALERT_THRESHOLD, WARN_FLOOR);
  }

  increment(): void {
    this.rolloverIfNewDay();
    this.count++;
    this.logProgress();
    if (!this.alerted && this.count >= this.warnAt) {
      this.alerted = true;
      this.sendAlert();
    }
  }

  isOverLimit(): boolean {
    this.rolloverIfNewDay();
    return this.count >= this.limit;
  }

  getStatus(): { count: number; limit: number; date: string } {
    return { count: this.count, limit: this.limit, date: this.date };
  }

  private rolloverIfNewDay(): void {
    const today = todayUTC();
    if (today !== this.date) {
      this.count = 0;
      this.date = today;
      this.alerted = false;
    }
  }

  private logProgress(): void {
    const limit = this.limit;
    const pct = ((this.count / limit) * 100).toFixed(1);
    if (this.count % 1_000 === 0 || this.count >= this.warnAt) {
      console.error(`[quota] ${this.count}/${limit} requests today (${pct}%)`);
    }
  }

  private sendAlert(): void {
    const limit = this.limit;
    const pct = ((this.count / limit) * 100).toFixed(1);
    sendSlackAlert(
      `⚠️ Gong API quota at ${pct}% — ${this.count}/${limit} requests used today` +
      ` (${this.date} UTC). Resets at midnight UTC.`
    );
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export const quotaTracker = new DailyQuotaTracker();
