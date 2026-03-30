import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3030';
// CRITICAL: Timeout must be longer than server pingTimeout (180s) to avoid premature disconnection
const REQUEST_TIMEOUT = 200000; // ~3.3 minutes - longer than server's 180s pingTimeout
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function log(...args: any[]) {
  console.log('[Socket.io Proxy]', new Date().toISOString().split('T')[1], ...args);
}

function createSocketioError(message: string, code: number = 500): NextResponse {
  return new NextResponse(`4${JSON.stringify({ message, code })}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
      clearTimeout(timeoutId);
      
      // Handle redirects explicitly - Socket.io doesn't like redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        log(`Unexpected redirect ${response.status} to:`, location);
        throw new Error(`Redirect not allowed (${response.status})`);
      }
      
      return response;
    } catch (error: any) {
      lastError = error;
      if (error.name === 'AbortError' || error.message?.includes('Redirect')) throw error;
      log(`Attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const transport = url.searchParams.get('transport') || 'polling';
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';

  const targetUrl = `${WHATSAPP_SERVICE_URL}/socket.io/?EIO=${EIO}&transport=${transport}${sid ? `&sid=${sid}` : ''}`;

  log('GET', { transport, sid: sid?.substring(0, 8) });

  try {
    const headers: Record<string, string> = { 'Accept': '*/*', 'Connection': 'keep-alive' };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    const response = await fetchWithRetry(targetUrl, { method: 'GET', headers });
    const text = await response.text();
    
    log('GET response:', response.status, 'len:', text.length);

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
    log('GET error:', error.message);
    if (error.name === 'AbortError') return createSocketioError('Timeout', 408);
    return createSocketioError(error.message || 'Service unavailable', 503);
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';
  const transport = url.searchParams.get('transport') || 'polling';

  const targetUrl = `${WHATSAPP_SERVICE_URL}/socket.io/?EIO=${EIO}&transport=${transport}${sid ? `&sid=${sid}` : ''}`;

  log('POST', { sid: sid?.substring(0, 8) });

  try {
    const body = await request.text();
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Connection': 'keep-alive',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    const response = await fetchWithRetry(targetUrl, { method: 'POST', headers, body });
    const text = await response.text();
    
    log('POST response:', response.status);

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Connection': 'keep-alive',
    };

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) responseHeaders['Set-Cookie'] = setCookie;

    return new NextResponse(text, { status: response.status, headers: responseHeaders });
  } catch (error: any) {
    log('POST error:', error.message);
    if (error.name === 'AbortError') return createSocketioError('Timeout', 408);
    return createSocketioError(error.message || 'Service unavailable', 503);
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
