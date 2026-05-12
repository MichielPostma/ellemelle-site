// Returns public config consumed by the front-end (Tikkie URLs + counter max).
// Env vars:
//   TIKKIE_LINK_A, TIKKIE_LINK_B  — two Tikkie payment links, randomized client-side
//   MAX_SIGNUPS                   — total spots in this batch (default 25)

exports.handler = async () => {
  const A = process.env.TIKKIE_LINK_A || 'https://tikkie.example.com/A';
  const B = process.env.TIKKIE_LINK_B || 'https://tikkie.example.com/B';
  const max = parseInt(process.env.MAX_SIGNUPS || '25', 10);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
    body: JSON.stringify({ tikkieA: A, tikkieB: B, maxSignups: max }),
  };
};
