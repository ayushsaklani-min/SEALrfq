import { NextResponse } from 'next/server';
import crypto from 'crypto';

// Simple in-memory store for nonces (in production, use database)
const nonceStore = new Map<string, string>();

export async function POST(request: Request) {
  try {
    const { bidId, vendor, nonce, rfqId } = await request.json();

    if (!bidId || !vendor || !nonce) {
      return NextResponse.json(
        { error: 'Missing required fields: bidId, vendor, nonce' },
        { status: 400 }
      );
    }

    const encryptedNonce = encryptNonce(nonce, vendor);
    nonceStore.set(bidId, encryptedNonce);

    return NextResponse.json({
      success: true,
      bidId,
      message: 'Nonce backed up successfully'
    });
  } catch (error) {
    console.error('Nonce backup error:', error);
    return NextResponse.json(
      { error: 'Failed to backup nonce' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bidId = searchParams.get('bidId');
    const vendor = searchParams.get('vendor');

    if (!bidId || !vendor) {
      return NextResponse.json(
        { error: 'Missing bidId or vendor' },
        { status: 400 }
      );
    }

    const encryptedNonce = nonceStore.get(bidId);
    if (!encryptedNonce) {
      return NextResponse.json(
        { error: 'Nonce not found' },
        { status: 404 }
      );
    }

    const nonce = decryptNonce(encryptedNonce, vendor);
    return NextResponse.json({ success: true, nonce });
  } catch (error) {
    console.error('Nonce retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve nonce' },
      { status: 500 }
    );
  }
}

function encryptNonce(nonce: string, vendor: string): string {
  const secret = process.env.NONCE_SECRET || 'default-nonce-secret-key-32ch';
  const key = crypto.createHmac('sha256', secret).update(vendor).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(nonce, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptNonce(encrypted: string, vendor: string): string {
  const secret = process.env.NONCE_SECRET || 'default-nonce-secret-key-32ch';
  const key = crypto.createHmac('sha256', secret).update(vendor).digest();
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}