// HiAnime API - Vercel HLS Proxy
// Adds CORS headers and proxies HLS streams from CDN
// This runs on Vercel's infrastructure which is NOT blocked by CDN

import axios from 'axios';

// Get the base URL for proxy rewriting from environment or request
function getProxyBaseUrl(req) {
  // Use environment variable if set (recommended for production)
  if (process.env.PROXY_BASE_URL) {
    return process.env.PROXY_BASE_URL.replace(/\/$/, '');
  }
  
  // Otherwise construct from request
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}`;
}

// Main handler function
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Accept-Encoding, Origin, Referer');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Cache-Control, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethods: ['GET', 'OPTIONS']
    });
  }

  const { url, referer } = req.query;

  // Validate URL parameter
  if (!url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ 
      error: 'URL parameter is required',
      usage: '/api/proxy?url=<encoded_url>&referer=<optional_referer>'
    });
  }

  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ 
      error: 'Invalid URL encoding',
      message: e.message 
    });
  }

  // Validate URL format
  try {
    new URL(decodedUrl);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ 
      error: 'Invalid URL format',
      url: decodedUrl 
    });
  }

  const rangeHeader = req.headers['range'];
  const decodedReferer = referer ? decodeURIComponent(referer) : 'https://megacloud.tv';

  try {
    // Build request headers to mimic a browser
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': decodedReferer,
      'Origin': decodedReferer,
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': req.headers['accept-encoding'] || 'identity',
    };

    // Forward range header if present (for video seeking)
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    // Fetch from CDN with timeout and redirect handling
    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: headers,
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500, // Don't throw for 4xx errors
      maxRedirects: 5,
      timeout: 30000,
      // Handle decompress manually to preserve raw response
      decompress: true,
    });

    // Handle upstream errors (4xx)
    if (response.status >= 400) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json({
        error: 'Upstream error',
        status: response.status,
        statusText: response.statusText,
        url: decodedUrl
      });
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Accept-Encoding, Origin, Referer');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Cache-Control, Content-Type, ETag');

    // Forward content type
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    // Forward content length
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    // Forward content range (important for video seeking)
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }

    // Forward accept-ranges
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    // Forward ETag for caching
    if (response.headers['etag']) {
      res.setHeader('ETag', response.headers['etag']);
    }

    // Forward Last-Modified
    if (response.headers['last-modified']) {
      res.setHeader('Last-Modified', response.headers['last-modified']);
    }

    // Cache control based on file type
    if (decodedUrl.endsWith('.ts') || decodedUrl.endsWith('.m4s') || decodedUrl.endsWith('.mp4')) {
      // Video segments - cache for 1 year (immutable)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (decodedUrl.endsWith('.m3u8') || decodedUrl.endsWith('.mpd')) {
      // Playlists - no cache (always fresh)
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      // Default - moderate caching
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    // Handle M3U8 playlist - rewrite URLs to go through proxy
    const isM3U8 = contentType.includes('mpegurl') || 
                   contentType.includes('x-mpegurl') || 
                   decodedUrl.endsWith('.m3u8');

    if (isM3U8) {
      const content = Buffer.from(response.data).toString('utf-8');
      const basePath = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
      const proxyBaseUrl = getProxyBaseUrl(req);
      const encodedReferer = encodeURIComponent(decodedReferer);

      // Process M3U8 content and rewrite URLs
      const lines = content.split('\n');
      const newLines = lines.map(line => {
        const trimmedLine = line.trim();
        
        // Keep comments and empty lines as-is
        if (!trimmedLine || trimmedLine.startsWith('#')) {
          // Handle EXT-X-KEY and EXT-X-MAP URLs in tags
          if (trimmedLine.includes('URI="')) {
            return rewriteUriInTag(trimmedLine, basePath, proxyBaseUrl, encodedReferer);
          }
          return line;
        }

        // Resolve relative URLs
        let targetUrl = trimmedLine;
        if (!trimmedLine.startsWith('http')) {
          targetUrl = new URL(trimmedLine, basePath).href;
        }

        // Encode and proxy the URL
        const encodedUrl = encodeURIComponent(targetUrl);
        return `${proxyBaseUrl}/api/proxy?url=${encodedUrl}&referer=${encodedReferer}`;
      });

      const newContent = newLines.join('\n');
      return res.status(response.status).send(newContent);
    }

    // Return binary data (video segments, etc.)
    return res.status(response.status).send(Buffer.from(response.data));

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ 
        error: 'Gateway timeout',
        message: 'Request to upstream timed out',
        url: decodedUrl
      });
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return res.status(502).json({ 
        error: 'DNS lookup failed',
        message: 'Could not resolve upstream host',
        url: decodedUrl
      });
    }
    
    if (error.response) {
      return res.status(error.response.status || 502).json({ 
        error: 'Upstream error',
        status: error.response.status,
        message: error.message,
        url: decodedUrl
      });
    }
    
    return res.status(500).json({ 
      error: 'Internal proxy error',
      message: error.message,
      url: decodedUrl
    });
  }
}

// Helper function to rewrite URIs in HLS tags
function rewriteUriInTag(tag, basePath, proxyBaseUrl, encodedReferer) {
  // Match URI="..." pattern
  return tag.replace(/URI="([^"]+)"/, (match, uri) => {
    let targetUrl = uri;
    if (!uri.startsWith('http')) {
      try {
        targetUrl = new URL(uri, basePath).href;
      } catch (e) {
        return match; // Return original if parsing fails
      }
    }
    const encodedUrl = encodeURIComponent(targetUrl);
    return `URI="${proxyBaseUrl}/api/proxy?url=${encodedUrl}&referer=${encodedReferer}"`;
  });
}
