import { NextRequest, NextResponse } from 'next/server';

// Railway Private Networking: Use internal DNS hostname
// Format: http://{SERVICE_NAME}.railway.internal:{PORT}
// Service name must match the Railway service name exactly
const WHATSAPP_SERVICE_HOST = process.env.WHATSAPP_SERVICE_HOST || 'localhost';
const WHATSAPP_SERVICE_PORT = process.env.WHATSAPP_SERVICE_PORT || '3030';
const WHATSAPP_SERVICE = `http://${WHATSAPP_SERVICE_HOST}:${WHATSAPP_SERVICE_PORT}`;

// Timeout configuration
// Short timeout for quick operations, long for session operations
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const SESSION_TIMEOUT = 60000; // 60 seconds for session operations

// Helper function to create fetch with timeout
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Determine timeout based on endpoint
function getTimeoutForEndpoint(path: string[]): number {
  const fullPath = path.join('/');
  // Session operations need longer timeout
  if (fullPath.includes('session') || fullPath.includes('start') || fullPath.includes('stop')) {
    return SESSION_TIMEOUT;
  }
  return DEFAULT_TIMEOUT;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = new URL(request.url);
  const targetUrl = `${WHATSAPP_SERVICE}/${path.join('/')}?${url.searchParams.toString()}`;
  const timeout = getTimeoutForEndpoint(path);

  try {
    const response = await fetchWithTimeout(
      targetUrl,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      timeout
    );

    // Try to parse response as JSON, fallback to text
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';

    if (isTimeout) {
      console.error('[WA API] GET timeout after', timeout, 'ms:', targetUrl);
      return NextResponse.json(
        { error: 'Request timeout', details: `Request timed out after ${timeout}ms` },
        { status: 408 }
      );
    }

    // Don't log ConnectionRefused during startup (expected when WA service not ready)
    const isConnectionRefused = error.code === 'ConnectionRefused' || 
      error.message?.includes('Unable to connect');
    
    if (!isConnectionRefused) {
      console.error('[WA API] GET error:', error.message || error);
    }
    
    return NextResponse.json(
      { error: 'Service unavailable', details: 'WhatsApp service is starting or not available' },
      { status: 503 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = new URL(request.url);
  const targetUrl = `${WHATSAPP_SERVICE}/${path.join('/')}?${url.searchParams.toString()}`;
  const timeout = getTimeoutForEndpoint(path);

  try {
    // Get raw body text first
    const rawBody = await request.text();
    console.log('[WA API] POST to:', targetUrl, 'Body:', rawBody?.substring(0, 200));

    const response = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: rawBody || undefined,
      },
      timeout
    );

    // Try to parse response as JSON, fallback to text
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    console.log('[WA API] Response:', response.status);

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';

    if (isTimeout) {
      console.error('[WA API] POST timeout after', timeout, 'ms:', targetUrl);
      return NextResponse.json(
        { error: 'Request timeout', details: `Request timed out after ${timeout}ms` },
        { status: 408 }
      );
    }

    // Don't log ConnectionRefused during startup
    const isConnectionRefused = error.code === 'ConnectionRefused' || 
      error.message?.includes('Unable to connect');
    
    if (!isConnectionRefused) {
      console.error('[WA API] POST error:', error.message || error);
    }
    
    return NextResponse.json(
      { error: 'Service unavailable', details: 'WhatsApp service is starting or not available' },
      { status: 503 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = new URL(request.url);
  const targetUrl = `${WHATSAPP_SERVICE}/${path.join('/')}?${url.searchParams.toString()}`;
  const timeout = getTimeoutForEndpoint(path);

  try {
    let body = null;
    try {
      body = await request.json();
    } catch {
      // No body
    }

    const response = await fetchWithTimeout(
      targetUrl,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      timeout
    );

    // Try to parse response as JSON, fallback to text
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';

    if (isTimeout) {
      console.error('[WA API] DELETE timeout after', timeout, 'ms:', targetUrl);
      return NextResponse.json(
        { error: 'Request timeout', details: `Request timed out after ${timeout}ms` },
        { status: 408 }
      );
    }

    // Don't log ConnectionRefused during startup
    const isConnectionRefused = error.code === 'ConnectionRefused' || 
      error.message?.includes('Unable to connect');
    
    if (!isConnectionRefused) {
      console.error('[WA API] DELETE error:', error.message || error);
    }
    
    return NextResponse.json(
      { error: 'Service unavailable', details: 'WhatsApp service is starting or not available' },
      { status: 503 }
    );
  }
}
