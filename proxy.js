// CORS headers must be set FIRST, before any logic
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req, res) {
  // Set CORS headers immediately on all responses
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, referer = 'https://megacloud.tv' } = req.query;

    // Validate URL parameter
    if (!url) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Decode the target URL
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL encoding' });
    }

    // Validate URL format
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`[Proxy] Fetching: ${targetUrl}`);
    console.log(`[Proxy] Referer: ${referer}`);

    // Fetch from upstream with proper headers
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'Origin': referer,
        'Connection': 'keep-alive',
      },
      redirect: 'follow',
    });

    console.log(`[Proxy] Upstream status: ${response.status}`);

    // If upstream returns error, forward it with CORS
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      console.error(`[Proxy] Upstream error ${response.status}:`, errorBody.substring(0, 200));
      
      return res.status(response.status).json({
        error: 'Upstream request failed',
        status: response.status,
        statusText: response.statusText,
      });
    }

    // Get content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.endsWith('.m3u8');
    const isTS = targetUrl.endsWith('.ts') || contentType.includes('mp2t');

    // Set appropriate headers based on content type
    res.setHeader('Content-Type', contentType);
    
    // Handle caching
    if (isTS) {
      // Cache segments longer
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (isM3U8) {
      // Don't cache playlists
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    // Handle range requests for video seeking
    const rangeHeader = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    
    if (rangeHeader) {
      res.setHeader('Content-Range', rangeHeader);
    }
    if (acceptRanges) {
      res.setHeader('Accept-Ranges', acceptRanges);
    }

    // Get content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // For M3U8 files, rewrite URLs to proxy through this service
    if (isM3U8) {
      const text = await response.text();
      
      // Get the base URL for resolving relative URLs
      const baseUrl = new URL(targetUrl);
      const proxyBase = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/proxy`;
      
      // Rewrite URLs in the playlist
      const rewritten = text.replace(
        /^(?!#)([^\s]+)/gm,
        (match) => {
          // Skip empty lines and comments
          if (!match.trim() || match.startsWith('#')) return match;
          
          // Resolve relative URLs
          let absoluteUrl;
          try {
            absoluteUrl = new URL(match, baseUrl).href;
          } catch (e) {
            return match;
          }
          
          // Proxy the URL
          return `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
        }
      );

      return res.status(200).send(rewritten);
    }

    // For binary data (TS segments), stream the response
    const arrayBuffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));

  } catch (error) {
    console.error('[Proxy] Error:', error);
    
    // Always return CORS headers even on crash
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
