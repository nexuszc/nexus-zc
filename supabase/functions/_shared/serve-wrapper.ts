import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

export type Handler = (req: Request) => Promise<Response>;

export function createServeHandler(mainHandler: Handler) {
  return serve(async (req: Request) => {
    try {
      const url = new URL(req.url);
      
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return await mainHandler(req);
    } catch (error) {
      console.error("Error in serve handler:", error);
      
      const statusCode = error?.status || error?.statusCode || 500;
      const message = error?.message || "Internal Server Error";
      
      return new Response(
        JSON.stringify({ 
          error: message,
          details: error?.details || undefined,
        }),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  });
}