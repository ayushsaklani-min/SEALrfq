'use client';

type NormalizeWalletErrorOptions = {
    programId?: string;
    context?: 'authorization' | 'execution';
};

export function normalizeWalletErrorMessage(rawMessage: string, options: NormalizeWalletErrorOptions = {}) {
    const message = rawMessage || '';
    const lower = message.toLowerCase();
    const programId = options.programId || 'the deployed RFQ program';
    const isParserFailure =
        lower.includes('failed to parse string') ||
        lower.includes('remaining invalid string');
    const isSealRfqStablecoinParserFailure =
        lower.includes('merkleproof; 2u32') ||
        lower.includes('pay_invoice_usdcx') ||
        lower.includes('pay_invoice_usad') ||
        lower.includes('test_usdcx_stablecoin.aleo/merkleproof') ||
        lower.includes('test_usad_stablecoin.aleo/merkleproof');

    if (
        isParserFailure &&
        (
            options.programId?.startsWith('sealrfq_') ||
            isSealRfqStablecoinParserFailure
        )
    ) {
        return options.context === 'authorization'
            ? `Shield wallet cannot authorize ${programId}. This is a wallet/program compatibility issue, not an RFQ form error. Update Shield or switch to a compatible deployed program version.`
            : `Shield wallet cannot parse ${programId}. This is a wallet/program compatibility issue, not an RFQ form error. Update Shield or switch to a compatible deployed program version.`;
    }

    return message;
}
