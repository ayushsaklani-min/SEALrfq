'use client';

import Link from 'next/link';

export default function LoginPage() {
    return (
        <div className="max-w-2xl mx-auto py-16 px-4">
            <div className="glass p-8 rounded-2xl border border-white/10">
                <h1 className="text-3xl font-bold mb-4">Connect Wallet</h1>
                <p className="text-gray-400 mb-6">
                    Use the `Connect Shield` button in the top navigation to sign in.
                </p>
                <Link
                    href="/"
                    className="inline-block px-5 py-3 rounded-xl bg-primary-600 hover:bg-primary-700"
                >
                    Back To Home
                </Link>
            </div>
        </div>
    );
}
