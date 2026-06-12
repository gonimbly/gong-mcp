const DAILY_LIMIT = 50_000;
const ALERT_THRESHOLD = 0.75;

class DailyQuotaTracker {
  private count = 0;
  private date = todayUTC();
  private alerted = false;

  increment(): void {
    this.rolloverIfNewDay();
    this.count++;
    this.logProgress();
    if (!this.alerted && this.count >= DAILY_LIMIT * ALERT_THRESHOLD) {
      this.alerted = true;
      this.sendAlert();
    }
  }

  isOverLimit(): boolean {
    this.rolloverIfNewDay();
    return this.count >= DAILY_LIMIT;
  }

  getStatus(): { count: number; limit: number; date: string } {
    return { count: this.count, limit: DAILY_LIMIT, date: this.date };
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
    const pct = ((this.count / DAILY_LIMIT) * 100).toFixed(1);
    if (this.count % 1_000 === 0 || this.count >= DAILY_LIMIT * ALERT_THRESHOLD) {
      console.error(`[quota] ${this.count}/${DAILY_LIMIT} requests today (${pct}%)`);
    }
  }

  private sendAlert(): void {
    const webhookUrl = process.env.ALERT_SLACK_WEBHOOK_URL;
    const pct = ((this.count / DAILY_LIMIT) * 100).toFixed(1);
    const msg =
      `⚠️ Gong API quota at ${pct}% — ${this.count}/${DAILY_LIMIT} requests used today` +
      ` (${this.date} UTC). Resets at midnight UTC.`;
    console.error(`[quota] ALERT: ${msg}`);
    if (!webhookUrl) return;
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg }),
    }).catch((err) => console.error("[quota] Slack alert failed:", err));
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export const quotaTracker = new DailyQuotaTracker();
