# HiAnime API - Vercel Proxy

A production-ready standalone HLS proxy deployed on Vercel to add CORS headers for CDN streaming.

## Why Separate Deployment?

| Component | Platform | Issue |
|-----------|----------|-------|
| Main API | Cloudflare Workers | Gets blocked by CDN (403 Forbidden) |
| **Proxy** | **Vercel** | **Can access CDN successfully** |
| CDN | Various | Doesn't send CORS headers, needs proxy to add them |

## Features

- **CORS Headers**: Automatically adds proper CORS headers for browser streaming
- **HLS Support**: Handles `.m3u8` playlists and `.ts` segments
- **URL Rewriting**: Automatically rewrites playlist URLs to proxy through this service
- **Range Requests**: Supports HTTP Range requests for video seeking
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Caching**: Smart caching policies (immutable for segments, no-cache for playlists)
- **Preflight Support**: Handles CORS OPTIONS preflight requests

## Quick Deploy

### Option 1: Vercel Dashboard (Recommended)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository containing this code
3. Click **Deploy**
4. Done! Your proxy is live at `https://your-project.vercel.app`

### Option 2: Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Navigate to project directory
cd hianime-vercel-proxy

# Install dependencies
npm install

# Deploy to production
vercel --prod
```

### Option 3: GitHub Integration

1. Fork this repository
2. Connect to [Vercel](https://vercel.com)
3. Auto-deploys on every push to main branch

## Usage

### Basic Proxy Request

```
GET https://your-proxy.vercel.app/api/proxy?url=<encoded_stream_url>&referer=<optional_referer>
```

### Example

```javascript
// Encode the target URL
const streamUrl = 'https://cdn.example.com/video/playlist.m3u8';
const encodedUrl = encodeURIComponent(streamUrl);

// Make request through proxy
const proxyUrl = `https://your-proxy.vercel.app/api/proxy?url=${encodedUrl}&referer=https://megacloud.tv`;

// Use in video player
video.src = proxyUrl;
```

### With Custom Referer

```javascript
const streamUrl = 'https://cdn.example.com/video/playlist.m3u8';
const referer = 'https://example-streaming-site.com';

const proxyUrl = `https://your-proxy.vercel.app/api/proxy?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(referer)}`;
```

## API Reference

### Endpoint

```
GET /api/proxy
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL-encoded stream URL to proxy |
| `referer` | string | No | URL-encoded referer URL (default: `https://megacloud.tv`) |

### Response Headers

| Header | Description |
|--------|-------------|
| `Access-Control-Allow-Origin` | `*` - Allows all origins |
| `Access-Control-Allow-Methods` | `GET, OPTIONS` |
| `Access-Control-Expose-Headers` | Exposes streaming-related headers |
| `Content-Type` | Preserved from upstream |
| `Content-Range` | For video seeking support |
| `Accept-Ranges` | `bytes` for range request support |
| `Cache-Control` | Smart caching based on file type |

### Error Responses

| Status | Description |
|--------|-------------|
| `400` | Missing or invalid URL parameter |
| `405` | Method not allowed (only GET/OPTIONS) |
| `502` | Upstream/DNS error |
| `504` | Gateway timeout |

## Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```env
# Optional: Set your deployed proxy URL for proper M3U8 URL rewriting
PROXY_BASE_URL=https://your-proxy.vercel.app

# Optional: Default referer for CDN requests
DEFAULT_REFERER=https://megacloud.tv
```

### Vercel Configuration

The `vercel.json` includes:
- Function timeout configuration (30 seconds)
- Route mappings
- CORS headers

## How It Works

1. **Request**: Client requests a stream URL through the proxy
2. **Fetch**: Proxy fetches from CDN with proper headers (User-Agent, Referer, etc.)
3. **CORS**: Proxy adds CORS headers to the response
4. **Rewrite**: For M3U8 playlists, all segment URLs are rewritten to proxy through this service
5. **Stream**: Binary data (TS segments) is streamed back to the client

## Troubleshooting

### 403 Forbidden

- Check that the `referer` parameter matches what the CDN expects
- Some CDNs block Vercel IPs - try deploying to a different region

### CORS Errors

- Ensure the proxy URL is correct
- Check browser console for specific CORS error messages

### Video Not Playing

- Verify the stream URL is accessible
- Check that the URL is properly encoded
- Ensure the referer is correct for the CDN

## License

MIT
