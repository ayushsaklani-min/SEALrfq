export default function PrivacyPage() {
    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <div className="glass p-8 rounded-2xl border border-white/10">
                <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
                <p className="text-gray-300 mb-4">
                    SealRFQ stores the minimum application data required to run RFQs, bids, sessions,
                    audit events, and escrow records.
                </p>
                <p className="text-gray-400 mb-4">
                    Wallet authentication uses signed challenges. Bid commitments and transaction status
                    records may be stored in the backend for workflow coordination and auditability.
                </p>
                <p className="text-gray-400">
                    This policy page is for the live demo build and should be replaced with a legal
                    review before production launch.
                </p>
            </div>
        </div>
    );
}
