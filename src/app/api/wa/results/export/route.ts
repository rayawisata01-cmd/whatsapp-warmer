import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Tier calculation based on message count
function calculateTier(messagesSent: number): { tier: number; tierName: string } {
  const total = messagesSent;
  if (total >= 500) return { tier: 5, tierName: 'Aged Pro' };
  if (total >= 300) return { tier: 4, tierName: 'High Quality' };
  if (total >= 200) return { tier: 3, tierName: 'Premium' };
  if (total >= 100) return { tier: 2, tierName: 'Regular' };
  return { tier: 1, tierName: 'Fresh Warmed' };
}

// GET - Export accounts to CSV
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tier = searchParams.get('tier');
    const ids = searchParams.get('ids'); // Comma-separated IDs for selected export
    const includeSold = searchParams.get('includeSold') === 'true';

    // Build where clause
    const where: any = {
      messagesSent: { gte: 50 },
    };

    if (tier) {
      where.tier = parseInt(tier);
    }

    if (!includeSold) {
      where.soldAt = null;
    }

    if (ids) {
      const idList = ids.split(',').map(id => id.trim()).filter(Boolean);
      where.id = { in: idList };
    }

    // Get accounts
    const accounts = await db.whatsAppAccount.findMany({
      where,
      include: {
        personality: true,
      },
      orderBy: [
        { tier: 'desc' },
        { messagesSent: 'desc' },
      ],
    });

    // Generate CSV
    const headers = [
      'phone_number',
      'display_name',
      'tier',
      'tier_name',
      'messages_sent',
      'messages_received',
      'total_messages',
      'health_score',
      'status',
      'pool',
      'last_active',
      'created_at',
      'sold_at',
      'sold_to',
    ];

    const rows = accounts.map(acc => {
      const tierInfo = calculateTier(acc.messagesSent);
      return [
        acc.phoneNumber || '',
        acc.personality?.name || acc.name || acc.id,
        tierInfo.tier,
        tierInfo.tierName,
        acc.messagesSent,
        acc.messagesReceived,
        acc.messagesSent + acc.messagesReceived,
        acc.healthScore,
        acc.status,
        acc.pool,
        acc.lastActivity ? new Date(acc.lastActivity).toISOString() : '',
        new Date(acc.createdAt).toISOString(),
        acc.soldAt ? new Date(acc.soldAt).toISOString() : '',
        acc.soldTo || '',
      ];
    });

    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        // Escape cells with commas or quotes
        const str = String(cell);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','))
    ].join('\n');

    // Return CSV with proper headers
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = tier ? `results-tier-${tier}-${timestamp}.csv` : `results-all-${timestamp}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[Export CSV API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export CSV' },
      { status: 500 }
    );
  }
}
