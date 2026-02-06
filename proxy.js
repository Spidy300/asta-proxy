exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { url, referer = 'https://megacloud.tv' } = event.queryStringParameters || {};

  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url' }) };
  }

  try {
    const targetUrl = decodeURIComponent(url);
    
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
        'Origin': referer,
      },
    });

    if (!response.ok) {
      return { 
        statusCode: response.status, 
        headers, 
        body: JSON.stringify({ error: 'Upstream failed', status: response.status }) 
      };
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');
    
    const responseHeaders = {
      ...headers,
      'Content-Type': contentType,
    };

    const contentRange = response.headers.get('content-range');
    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    
    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges;

    // Handle M3U8 - rewrite URLs
    if (isM3U8) {
      const text = await response.text();
      const baseUrl = new URL(targetUrl);
      const proxyBase = `https://${event.headers.host}/proxy?`;
      
      const rewritten = text.replace(
        /^(?!#)([^\s]+)/gm,
        (match) => {
          if (!match.trim() || match.startsWith('#')) return match;
          try {
            const absoluteUrl = new URL(match, baseUrl).href;
            return `${proxyBase}url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
          } catch (e) {
            return match;
          }
        }
      );
      
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: rewritten,
      };
    }

    // Binary data
    const buffer = await response.arrayBuffer();
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true,
    };

  } catch (error) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
