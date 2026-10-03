import { NextResponse } from 'next/server';
import { formSigningSecret } from '../../_forms/form-secret';
import { mintSpamChallenge } from '../../_forms/spam-challenge';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(mintSpamChallenge(await formSigningSecret(), Date.now()));
}
