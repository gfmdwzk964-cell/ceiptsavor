// finance-chat — answers questions about a signed-in user's own finances.
// Keeps the Anthropic key server-side. Deploy: supabase functions deploy finance-chat
// Secrets needed: ANTHROPIC_API_KEY (already set for scan-receipt). Optional: CHAT_MODEL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED = ["https://ceiptsavor.com", "https://www.ceiptsavor.com", "http://localhost:8888"];
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get("Origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });

  // Only signed-in users
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Please sign in again." }), { status: 401, headers });

  let body: { question?: string; context?: unknown };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers }); }
  const question = String(body.question ?? "").trim().slice(0, 1000);
  if (!question) return new Response(JSON.stringify({ error: "Ask a question first." }), { status: 400, headers });
  const context = JSON.stringify(body.context ?? {}).slice(0, 60000);

  const system = `You are a helpful financial assistant for a small business owner.
Answer questions about their business finances using ONLY the data provided.
Be concise, friendly, and specific. Use dollar amounts and percentages where relevant.
Never give tax advice — for tax questions, say "Please consult your accountant."
Never make up data not in the context.

Business financial data:
${context}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: Deno.env.get("CHAT_MODEL") ?? "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) {
    console.error("anthropic error", res.status, await res.text());
    return new Response(JSON.stringify({ error: "The assistant is unavailable right now." }), { status: 502, headers });
  }
  const data = await res.json();
  const answer = (data.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
  return new Response(JSON.stringify({ answer }), { headers });
});
