export const onRequest = ({ request }: { request: Request }) => {
  const origin = new URL(request.url).origin;
  return Response.json(
    { url: origin, name: "Gram Miner", iconUrl: `${origin}/favicon.ico` },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } },
  );
};
