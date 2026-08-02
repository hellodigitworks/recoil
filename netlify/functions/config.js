// Hands the browser the client id and the exact redirect URI to use. The
// secret never leaves the server.

// Whoop matches the redirect URI character for character, so it has to be this
// deploy's own origin. Netlify sets URL on every deploy; the request host is
// the fallback, which is what makes a fork, a branch preview and `netlify dev`
// all work without anyone editing a file.
function siteUrl(event) {
  if (process.env.URL) return process.env.URL;
  const headers = (event && event.headers) || {};
  const host = headers.host || headers.Host || '';
  const proto = headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.WHOOP_CLIENT_ID || '',
      redirectUri: siteUrl(event) + '/callback'
    })
  };
};

exports.siteUrl = siteUrl;
