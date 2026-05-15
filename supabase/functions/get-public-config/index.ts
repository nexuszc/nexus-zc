Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      }
    });
  }

  return new Response(
    JSON.stringify({
      stripe_publishable_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY") || ""
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    }
  );
});
