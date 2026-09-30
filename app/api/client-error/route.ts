// POST /api/client-error: writes a browser-side error to the server log.
// Nothing is stored; the log is what Vercel keeps for runtime output.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const text = (await req.text()).slice(0, 6000);
  console.error("[client-error]", text);
  return new Response(null, { status: 204 });
}
