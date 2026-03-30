import { NextRequest, NextResponse } from 'next/server';

// WHATSAPP SERVICE URL - Use environment variable for flexibility
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3030';

// CRITICAL: Timeout harus sinkron dengan Socket.io server pingTimeout (120s)
const REQUEST_TIMEOUT = 120000; // 120 seconds

// Retry configuration for robust connection
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second between retries

// Connection health cache
let lastHealthCheck = 0;
let isServiceHealthy = false;
const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

/**
 * Check if WhatsApp service is reachable
 * Caches result to avoid excessive checks
 */
async function checkServiceHealth(): Promise<boolean> {
  const now = Date.now();
  
  // Use cached result if recent
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return isServiceHealthy;
  }
  
  lastHealthCheck = now;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    isServiceHealthy = response.ok;
    
    if (isServiceHealthy) {
      console.log('[Socket.io Proxy] Service health check: OK');
    } else {
      console.error('[Socket.io Proxy] Service health check: FAILED (status:', response.status, ')');
    }
    
    return isServiceHealthy;
  } catch (error: any) {
    isServiceHealthy = false;
    console.error('[Socket.io Proxy] Service health check: ERROR -', error.message);
    return false;
  }
}

/**
 * Create a Socket.io compatible error response
 * Socket.io expects plain text in specific format
 */
function createSocketioError(message: string, code: number = 500): NextResponse {
  // Socket.io error packet format: "4{json}"
  const errorPacket = `4${JSON.stringify({ message, code })}`;
  return new NextResponse(errorPacket, {
    status: 200, // Socket.io handles errors in packet, HTTP should be 200
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Fetch with retry logic for robust connection
 */
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on abort (timeout)
      if (error.name === 'AbortError') {
        throw error;
      }
      
      // Log retry attempt
      console.error(`[Socket.io Proxy] Attempt ${attempt}/${retries} failed:`, error.message);
      
      // Wait before retry (except on last attempt)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  
  throw lastError;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const transport = url.searchParams.get('transport') || 'polling';
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';

  let targetUrl = `${WHATSAPP_SERVICE_URL}/socket.io/?EIO=${EIO}&transport=${transport}`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  // For existing sessions, check service health first
  if (sid) {
    const healthy = await checkServiceHealth();
    if (!healthy) {
      console.error('[Socket.io Proxy] GET rejected - service unhealthy, sid:', sid);
      return createSocketioError('WhatsApp service unavailable, please refresh', 503);
    }
  }

  try {
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    // Use fetch with retry
    const response = await fetchWithRetry(targetUrl, {
      method: 'GET',
      headers,
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=120',
      },
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[Socket.io Proxy] GET timeout after', REQUEST_TIMEOUT, 'ms');
      return createSocketioError('Request timeout', 408);
    }
    console.error('[Socket.io Proxy] GET error after retries:', error?.message || error);
    return createSocketioError(error?.message || 'Service unavailable', 503);
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';
  const transport = url.searchParams.get('transport') || 'polling';

  let targetUrl = `${WHATSAPP_SERVICE_URL}/socket.io/?EIO=${EIO}&transport=${transport}`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  try {
    const body = await request.text();

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Connection': 'keep-alive',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    // Use fetch with retry
    const response = await fetchWithRetry(targetUrl, {
      method: 'POST',
      headers,
      body,
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[Socket.io Proxy] POST timeout after', REQUEST_TIMEOUT, 'ms');
      return createSocketioError('Request timeout', 408);
    }
    console.error('[Socket.io Proxy] POST error after retries:', error?.message || error);
    return createSocketioError(error?.message || 'Service unavailable', 503);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Connection': 'keep-alive',
    },
  });
}
