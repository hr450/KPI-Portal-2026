// Public, non-secret values the login screen needs.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    domain: (process.env.ALLOWED_DOMAIN || 'rankviz.com').toLowerCase(),
  });
}
