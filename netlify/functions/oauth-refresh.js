// Exchanges a Whoop refresh token for a fresh access token.
//
// This has to live server-side because Whoop requires the client secret on the
// refresh call. Whoop rotates the refresh token on every use, so the caller
// must persist whatever comes back here.
//
// Uses the same hand-rolled https POST as oauth-exchange.js rather than fetch,
// deliberately: that helper is the one that finally satisfied Whoop's token
// endpoint (form-encoded body, exact Content-Length) and is not worth
// re-litigating on the auth path.

const https = require('https');

function httpsPost(urlStr, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const body = Object.keys(data).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k])).join('&');
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(responseData); } catch (e) {}
        resolve({ status: res.statusCode, raw: responseData, json: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', function () {
      this.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { refresh_token: refreshToken } = JSON.parse(event.body || '{}');
    if (!refreshToken) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'no_refresh_token',
          message: 'No refresh token stored, so there is nothing to renew. Reconnect Whoop.'
        })
      };
    }

    const clientId = process.env.WHOOP_CLIENT_ID;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'missing_credentials', message: 'WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET are not set in Netlify.' })
      };
    }

    const res = await httpsPost('https://api.prod.whoop.com/oauth/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'offline'
    });

    const token = res.json || {};

    if (res.status !== 200 || token.error || !token.access_token) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'refresh_failed',
          message: token.error_description || token.error || 'Whoop refused to refresh the token.',
          whoopStatus: res.status,
          whoopBody: String(res.raw).slice(0, 600)
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token.access_token,
        // Whoop rotates this. Persisting the new one is not optional.
        refresh_token: token.refresh_token || refreshToken,
        expires_in: token.expires_in || 3600
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'refresh_crashed', message: error.message })
    };
  }
};
