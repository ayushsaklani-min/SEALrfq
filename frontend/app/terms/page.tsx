export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <div className="glass p-8 rounded-2xl border border-white/10">
                <h1 className="text-3xl font-bold mb-4">Terms of Service</h1>
                <p className="text-gray-300 mb-4">
                    The current SealRFQ deployment is a prototype and investor demo environment.
                </p>
                <p className="text-gray-400 mb-4">
                    It is provided for evaluation only and should not be used for real procurement,
                    regulated purchasing, or production fund flows without a full security, legal,
                    and compliance review.
                </p>
                <p className="text-gray-400">
                    By using this demo, you acknowledge that features, uptime, and data retention may
                    change without notice.
                </p>
            </div>
        </div>
    );
}
