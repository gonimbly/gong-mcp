export function sendSlackAlert(msg: string): void {
  const webhookUrl = process.env.ALERT_SLACK_WEBHOOK_URL;
  console.error(`[alert] ${msg}`);
  if (!webhookUrl) return;
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg }),
  }).catch((err) => console.error("[alert] Slack alert failed:", err));
}
