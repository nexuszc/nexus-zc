Deno.serve(async (_req) => {
  return Response.json({ ok: true, status: "healthy", ts: new Date().toISOString() });
});
