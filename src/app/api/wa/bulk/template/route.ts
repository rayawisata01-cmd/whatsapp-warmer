/**
 * Bulk Template Download API Route
 * 
 * Returns a CSV template for bulk account upload.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const csvContent = `accountId,phoneNumber,usePairingCode
account-1,628123456789,false
account-2,628123456790,true
account-3,,false`;
  
  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="bulk-accounts-template.csv"'
    }
  });
}
