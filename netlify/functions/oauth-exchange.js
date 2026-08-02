const https = require('https');
const { siteUrl } = require('./config');

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
    req.on('timeout', function() {
      this.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { code } = JSON.parse(event.body);
    if (!code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing code' })
      };
    }

    const clientId = process.env.WHOOP_CLIENT_ID;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing credentials' })
      };
    }

    // Must be byte-identical to the one config.js gave the browser, or Whoop
    // rejects the exchange.
    const redirectUri = siteUrl(event) + '/callback';
    const tokenResponse = await httpsPost('https://api.prod.whoop.com/oauth/oauth2/token', {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    });

    const token = tokenResponse.json || {};

    if (tokenResponse.status !== 200 || token.error || !token.access_token) {
      // Surface Whoop's exact rejection so we can diagnose, not guess. Nothing
      // derived from the client id or secret goes in here: this body reaches
      // the browser, and even a length or a tail is credential material.
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: token.error_description || token.error || 'OAuth error',
          debug: {
            whoopStatus: tokenResponse.status,
            whoopRaw: tokenResponse.raw,
            sentRedirectUri: redirectUri
          }
        })
      };
    }

    // refresh_token is only present when the `offline` scope was requested.
    // Without it the session dies when the access token expires (~1 hour).
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token.access_token,
        refresh_token: token.refresh_token || null,
        expires_in: token.expires_in || 3600,
        scope: token.scope || ''
      })
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
