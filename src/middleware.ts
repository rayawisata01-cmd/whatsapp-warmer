import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to handle trailing slashes for Socket.io API routes
 * 
 * CRITICAL: Socket.io client may request /api/socket.io/ with trailing slash.
 * Next.js default behavior is to redirect (HTTP 308) which breaks Socket.io polling.
 * 
 * Solution: REWRITE the URL internally (no redirect) to strip trailing slash.
 * This makes the request appear to come from /api/socket.io without changing
 * the URL in the client's perspective.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = new URL(request.url);
  
  // Handle Socket.io routes with trailing slashes - REWRITE, don't redirect!
  if (pathname === '/api/socket.io/' || pathname.startsWith('/api/socket.io//')) {
    // Remove trailing slash(es) and rewrite URL internally
    const cleanPathname = pathname.replace(/\/+$/, '');
    const newUrl = new URL(cleanPathname + search, request.url);
    
    console.log('[Middleware] Rewriting Socket.io path:', pathname, '→', cleanPathname);
    
    // Use rewrite instead of redirect - client sees no change
    return NextResponse.rewrite(newUrl);
  }
  
  // For other API routes with trailing slashes, also rewrite
  if (pathname.startsWith('/api/') && pathname.endsWith('/') && pathname !== '/api/') {
    const cleanPathname = pathname.slice(0, -1);
    const newUrl = new URL(cleanPathname + search, request.url);
    
    console.log('[Middleware] Rewriting API path:', pathname, '→', cleanPathname);
    
    return NextResponse.rewrite(newUrl);
  }
  
  // Continue with the request
  return NextResponse.next();
}

// Configure middleware to run on API routes
export const config = {
  matcher: [
    '/api/:path*/',
    '/api/socket.io',
  ],
};
