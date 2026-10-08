// Vercel function: the page's best-effort log calls. On Vercel nothing is
// stored (visitors' names and towns are never written down), so this just
// says thanks.
export default function handler(_req, res) {
  res.status(204).end();
}
