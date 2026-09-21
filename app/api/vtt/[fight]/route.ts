import { NextResponse } from 'next/server'
import { readMailbox, writeMailbox } from '../../../vtt/mailbox'

// The mailbox as a VTT sees it: GET the latest snapshot, POST a new one.
// Open to any origin, since a Foundry module calls it from the VTT's own
// page; the fight id is the only handle, so keep it unguessable.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

type Params = { params: Promise<{ fight: string }> }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(_request: Request, { params }: Params) {
  const { fight } = await params
  try {
    const snapshot = await readMailbox(fight)
    if (!snapshot) return NextResponse.json({ error: 'no snapshot' }, { status: 404, headers: CORS })
    return NextResponse.json(snapshot, { headers: CORS })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'mailbox unavailable' }, { status: 503, headers: CORS })
  }
}

export async function POST(request: Request, { params }: Params) {
  const { fight } = await params
  try {
    const body: unknown = await request.json()
    const stored = await writeMailbox(fight, body)
    if (!stored) return NextResponse.json({ error: 'not a snapshot' }, { status: 400, headers: CORS })
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'mailbox unavailable' }, { status: 503, headers: CORS })
  }
}
