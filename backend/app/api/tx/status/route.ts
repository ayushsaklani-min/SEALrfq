import { NextRequest, NextResponse } from 'next/server';

/**
 * Transaction status response from Aleo network query
 */
interface TxStatusResponse {
  txId: string;
  status: 'pending' | 'confirmed' | 'failed' | 'unknown';
  confirmations: number;
  blockHeight?: number;
  programId?: string;
  functionName?: string;
  fee?: number;
  timestamp?: string;
  message?: string;
  error?: string;
}

/**
 * Aleo transaction response shape (subset of fields we use)
 */
interface AleoTransactionResponse {
  block_height?: number;
  block_hash?: string;
  status?: string;
  type?: string;
  fee?: {
    global_state_root?: string;
    inclusion_proof?: string;
    transition?: {
      id?: string;
      program?: string;
      function?: string;
    };
  };
  execution?: {
    transitions?: Array<{
      id?: string;
      program?: string;
      function?: string;
      inputs?: Array<{ type: string; id?: string; value?: string }>;
      outputs?: Array<{ type: string; id?: string; value?: string }>;
    }>;
    global_state_root?: string;
    inclusion_proof?: string;
  };
}

/**
 * GET /api/tx/status?txId=<transaction_id>
 * 
 * Queries the Aleo network for transaction status by transaction ID.
 * Returns confirmation status, block height, program details, and timing.
 */
export async function GET(request: NextRequest): Promise<NextResponse<TxStatusResponse>> {
  const txId = request.nextUrl.searchParams.get('txId');

  if (!txId) {
    return NextResponse.json(
      { 
        txId: '', 
        status: 'unknown', 
        confirmations: 0, 
        error: 'txId query parameter is required' 
      } satisfies TxStatusResponse,
      { status: 400 }
    );
  }

  // Validate transaction ID format (Aleo transaction IDs start with 'at1')
  if (!txId.startsWith('at1') || txId.length < 50) {
    return NextResponse.json(
      {
        txId,
        status: 'unknown',
        confirmations: 0,
        error: 'Invalid transaction ID format. Aleo transaction IDs start with "at1"'
      } satisfies TxStatusResponse,
      { status: 400 }
    );
  }

  // Use environment variable or default to Aleo testnet explorer API
  const aleoRpc = process.env.ALEO_RPC_URL || 'https://api.explorer.provable.com/v1/testnet';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(`${aleoRpc}/transaction/${txId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Transaction not found or not yet confirmed
    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({
          txId,
          status: 'pending',
          confirmations: 0,
          message: 'Transaction not yet confirmed on the network. It may still be processing.',
          timestamp: new Date().toISOString(),
        } satisfies TxStatusResponse);
      }

      // Other HTTP errors
      return NextResponse.json({
        txId,
        status: 'unknown',
        confirmations: 0,
        error: `Network returned status ${response.status}`,
        timestamp: new Date().toISOString(),
      } satisfies TxStatusResponse, { status: 502 });
    }

    const data: AleoTransactionResponse = await response.json();

    // Extract program and function from execution transitions
    const firstTransition = data.execution?.transitions?.[0];
    const programId = firstTransition?.program;
    const functionName = firstTransition?.function;

    // Calculate fee if available (fee is in microcredits)
    const feeTransition = data.fee?.transition;
    let fee: number | undefined;
    if (feeTransition) {
      // Fee is typically in the execution structure
      fee = undefined; // Aleo API doesn't directly expose fee amount in this format
    }

    return NextResponse.json({
      txId,
      status: 'confirmed',
      confirmations: data.block_height ? 1 : 0,
      blockHeight: data.block_height,
      programId,
      functionName,
      fee,
      timestamp: new Date().toISOString(),
    } satisfies TxStatusResponse);

  } catch (error) {
    // Handle specific error types
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json({
          txId,
          status: 'unknown',
          confirmations: 0,
          error: 'Request timed out while querying the network',
          timestamp: new Date().toISOString(),
        } satisfies TxStatusResponse, { status: 504 });
      }

      // Network or parsing errors
      return NextResponse.json({
        txId,
        status: 'unknown',
        confirmations: 0,
        error: `Failed to query network: ${error.message}`,
        timestamp: new Date().toISOString(),
      } satisfies TxStatusResponse, { status: 500 });
    }

    // Unknown error type
    return NextResponse.json({
      txId,
      status: 'unknown',
      confirmations: 0,
      error: 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
    } satisfies TxStatusResponse, { status: 500 });
  }
}
