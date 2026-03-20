import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PageHeader, PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';
import { Gavel, TrendingDown } from 'lucide-react';

const cards = [
    {
        href: '/auctions/vickrey',
        title: 'Vickrey',
        description: 'Sealed bids. Lowest revealed bidder wins, but pays the second price.',
        detail: 'Use when you want sealed competition before importing the result into an RFQ.',
        icon: Gavel,
        accent: 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]',
    },
    {
        href: '/auctions/dutch',
        title: 'Dutch',
        description: 'Price falls block by block until a bidder accepts it.',
        detail: 'Use when speed matters more than hidden price discovery.',
        icon: TrendingDown,
        accent: 'bg-amber-500/12 text-amber-300',
    },
];

export default function AuctionsPage() {
    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="Choose an auction"
                description="Both auction types can be linked to an RFQ and imported back into the v15 settlement flow."
            />

            <div className="grid gap-4 md:grid-cols-2">
                {cards.map((card) => (
                    <Panel key={card.title} title={card.title} subtitle={card.description} className="h-full">
                        <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.accent}`}>
                            <card.icon className="h-5 w-5" />
                        </div>
                        <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">{card.detail}</p>
                        <div className="mt-5">
                            <Link href={card.href}>
                                <Button>Open {card.title}</Button>
                            </Link>
                        </div>
                    </Panel>
                ))}
            </div>
        </PageShell>
    );
}
