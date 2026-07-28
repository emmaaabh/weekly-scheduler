import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { webhookUrl, text } = await request.json();

    if (!webhookUrl || !text) {
      return NextResponse.json({ error: 'Missing webhookUrl or text' }, { status: 400 });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json({ error: `Slack error: ${body}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
