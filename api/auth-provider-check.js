// Serverless handler to probe Supabase Auth OAuth provider status without CORS restrictions
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
  const provider = (req.query.provider || 'google').toLowerCase();

  try {
    const probeRes = await fetch(`${supabaseUrl}/auth/v1/authorize?provider=${provider}`, {
      method: 'GET',
      redirect: 'manual'
    });

    // Supabase returns HTTP 400 with { code: 400, error_code: 'validation_failed', msg: 'Unsupported provider: provider is not enabled' }
    // if the provider is not enabled in Supabase Dashboard -> Authentication -> Providers.
    if (probeRes.status === 400) {
      const errJson = await probeRes.json().catch(() => ({}));
      return res.status(200).json({
        enabled: false,
        status: 400,
        provider,
        error: errJson.msg || errJson.message || 'Unsupported provider: provider is not enabled in Supabase Dashboard'
      });
    }

    // 302 or 200 indicates the provider is enabled and redirecting to the OAuth provider (e.g. accounts.google.com)
    return res.status(200).json({
      enabled: true,
      provider,
      status: probeRes.status
    });
  } catch (err) {
    return res.status(200).json({
      enabled: false,
      provider,
      error: err.message
    });
  }
}
