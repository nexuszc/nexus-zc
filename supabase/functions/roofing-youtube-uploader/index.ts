// roofing-youtube-uploader — RETIRED v8
// Creatomate rendering removed. YouTube videos now rendered by VPS recorder
// at /opt/roofing/youtube/recorder.js — runs Monday 6am MT via pm2 cron.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  return Response.json({
    ok: true,
    message: "Creatomate uploader retired. YouTube videos rendered by VPS recorder at /opt/roofing/youtube/. Runs Monday 6am MT via pm2 cron.",
    vps_recorder: "youtube-recorder",
    next_run: "Monday 6am MT",
  }, { headers: CORS });
});
