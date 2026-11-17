import { runSync } from "../lib/sync-loto-core.mjs";

export default async function handler(req, context) {
  try {
    const result = await runSync();
    console.log("LotHope scheduled sync:", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    console.error("LotHope scheduled sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

// RD esta en UTC-4 todo el ano:
// miercoles/sabado 9:10 PM RD = jueves/domingo 1:10 AM UTC
export const config = {
  schedule: "10 1 * * 4,0"
};
