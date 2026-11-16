import { runSync } from "../lib/sync-loto-core.mjs";

export default async function scheduledHandler() {
  const result = await runSync();
  console.log("LotHope scheduled sync:", JSON.stringify(result));
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

// República Dominicana está en UTC-4 todo el año:
// miércoles/sábado 9:10 PM RD = jueves/domingo 1:10 AM UTC.
export const config = {
  schedule: "10 1 * * 4,0"
};
