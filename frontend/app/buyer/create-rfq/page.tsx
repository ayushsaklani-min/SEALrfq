'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    SelectInput,
    TextAreaInput,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import {
    createRfqSchema,
    formatAmount,
    formatBlockTime,
    hashToField,
    pricingLabel,
    PRICING_MODE,
    randomField,
    TIMING,
    TOKEN_TYPE,
} from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type PlatformPayload = {
    initialized: boolean;
    paused: boolean;
    isAdmin: boolean;
    feeBps: number;
};

function toMicroUnits(value: string): string | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return String(Math.round(numeric * 1_000_000));
}

export default function CreateRfqPage() {
    const { walletAddress } = useWallet();
    const saveRfqSalt = useProtocolStore((state) => state.saveRfqSalt);
    const setPlatformConfig = useProtocolStore((state) => state.setPlatformConfig);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [platform, setPlatform] = useState<PlatformPayload | null>(null);
    const [itemName, setItemName] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');
    const [biddingDeadline, setBiddingDeadline] = useState('');
    const [revealDeadline, setRevealDeadline] = useState('');
    const [minBid, setMinBid] = useState('');
    const [minBidCount, setMinBidCount] = useState('1');
    const [tokenType, setTokenType] = useState(String(TOKEN_TYPE.CREDITS));
    const [pricingMode, setPricingMode] = useState(String(PRICING_MODE.RFQ));
    const [rfqId, setRfqId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const [blockHeight, configResponse] = await Promise.all([
                fetchCurrentBlockHeight(),
                authenticatedFetch('/api/platform/config').catch(() => null),
            ]);

            if (cancelled) return;

            if (blockHeight) {
                setCurrentBlock(blockHeight);
                setBiddingDeadline(String(blockHeight + 360));
                setRevealDeadline(String(blockHeight + 360 + TIMING.MIN_REVEAL_WINDOW));
            }

            if (configResponse) {
                const payload = await configResponse.json().catch(() => null);
                if (configResponse.ok && payload?.data) {
                    setPlatform(payload.data);
                    setPlatformConfig(payload.data);
                }
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [setPlatformConfig]);

    const minBidMicro = toMicroUnits(minBid);
    const revealWindow = biddingDeadline && revealDeadline ? Number(revealDeadline) - Number(biddingDeadline) : 0;
    const bidWindow = biddingDeadline && currentBlock ? Number(biddingDeadline) - currentBlock : 0;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setError(null);

        try {
            if (!walletAddress) throw new Error('Connect your wallet first.');
            if (!platform?.initialized) throw new Error('Platform config has not been initialized yet.');
            if (platform.paused) throw new Error('Platform is paused. New RFQs are blocked.');
            if (!itemName.trim()) throw new Error('Enter a short title for the RFQ.');

            const minBidValue = toMicroUnits(minBid);
            if (!minBidValue) throw new Error('Enter a valid minimum bid.');

            const salt = randomField();
            const metadataHash = await hashToField([
                'RFQ_METADATA',
                itemName.trim(),
                description.trim(),
                quantity.trim(),
                unit.trim(),
            ]);
            const parsed = createRfqSchema.parse({
                salt,
                metadataHash,
                biddingDeadline: Number(biddingDeadline),
                revealDeadline: Number(revealDeadline),
                minBid: minBidValue,
                minBidCount: Number(minBidCount),
                tokenType: Number(tokenType),
                pricingMode: Number(pricingMode),
            });

            const prepareBody = {
                ...parsed,
                itemName: itemName.trim(),
                description: description.trim(),
                quantity: quantity.trim(),
                unit: unit.trim(),
            };

            const result = await walletFirstTx('/api/rfq/create', prepareBody, (_prepareData, txHash) => ({
                ...prepareBody,
                txHash,
            }));

            saveRfqSalt(result.data.rfq_id, salt);
            setRfqId(result.data.rfq_id);
            setIdempotencyKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to create RFQ.');
            setSubmitting(false);
        }
    };

    if (idempotencyKey && rfqId) {
        return (
            <PageShell className="space-y-6">
                <PageHeader
                    eyebrow="Buyer"
                    title="RFQ created"
                    description="The RFQ id was derived locally and the wallet transaction was submitted against the v15 program."
                />
                <Panel title="Submission status">
                    <div className="space-y-4">
                        <DataGrid>
                            <DataPoint label="RFQ id" value={<span className="break-all">{rfqId}</span>} />
                            <DataPoint label="Settlement token" value={Number(tokenType) === TOKEN_TYPE.USDCX ? 'USDCx' : Number(tokenType) === TOKEN_TYPE.USAD ? 'USAD' : 'ALEO'} />
                        </DataGrid>
                        <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                        <ActionBar>
                            <Link
                                href={`/buyer/rfqs/${encodeURIComponent(rfqId)}`}
                                className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
                            >
                                Open RFQ
                            </Link>
                            <Link
                                href="/buyer/create-rfq"
                                className="inline-flex rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-white"
                            >
                                Create another
                            </Link>
                        </ActionBar>
                    </div>
                </Panel>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title="Create RFQ"
                description="Set the item, deadlines, token, and pricing mode. The RFQ id and salt are generated automatically."
                actions={
                    <ActionBar>
                        <TokenChip tokenType={Number(tokenType)} />
                        <PricingChip pricingMode={Number(pricingMode)} />
                    </ActionBar>
                }
            />

            {!platform?.initialized ? (
                <Notice tone="warning" title="Platform setup required">
                    The admin must initialize `platform_config[0u8]` before RFQs can be created.
                </Notice>
            ) : null}

            {platform?.paused ? (
                <Notice tone="warning" title="Platform paused">
                    RFQ creation is temporarily disabled.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel title="RFQ form" subtitle="All deadlines are block numbers. Stakes are always held in ALEO credits.">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <Field label="What are you buying?">
                                <TextInput value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Industrial pump assembly" />
                            </Field>
                            <Field label="Description" hint="Use this for specs, delivery notes, and compliance requirements.">
                                <TextAreaInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Scope, specifications, delivery terms, inspection requirements." />
                            </Field>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Quantity">
                                    <TextInput value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="100" />
                                </Field>
                                <Field label="Unit">
                                    <TextInput value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="units, kg, cases" />
                                </Field>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Minimum acceptable bid" hint="Displayed in the selected settlement token.">
                                <TextInput type="number" min="0.000001" step="0.000001" value={minBid} onChange={(event) => setMinBid(event.target.value)} placeholder="125" />
                            </Field>
                            <Field label="Minimum vendor count" hint="RFQ can be cancelled after bidding closes if this is not met.">
                                <TextInput type="number" min="1" value={minBidCount} onChange={(event) => setMinBidCount(event.target.value)} />
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Bid close block" hint="Must be after the current block and within the max RFQ range.">
                                <TextInput type="number" value={biddingDeadline} onChange={(event) => setBiddingDeadline(event.target.value)} />
                            </Field>
                            <Field label="Reveal close block" hint={`Reveal must stay open for at least ${TIMING.MIN_REVEAL_WINDOW} blocks.`}>
                                <TextInput type="number" value={revealDeadline} onChange={(event) => setRevealDeadline(event.target.value)} />
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Settlement token" hint="Winner payments settle in this token. Stake remains in ALEO credits.">
                                <SelectInput value={tokenType} onChange={(event) => setTokenType(event.target.value)}>
                                    <option value={TOKEN_TYPE.CREDITS}>ALEO credits</option>
                                    <option value={TOKEN_TYPE.USDCX}>USDCx</option>
                                    <option value={TOKEN_TYPE.USAD}>USAD</option>
                                </SelectInput>
                            </Field>
                            <Field label="Price source" hint="Choose whether the RFQ runs its own sealed flow or imports an auction result.">
                                <SelectInput value={pricingMode} onChange={(event) => setPricingMode(event.target.value)}>
                                    <option value={PRICING_MODE.RFQ}>RFQ sealed bids</option>
                                    <option value={PRICING_MODE.VICKREY}>Import Vickrey result</option>
                                    <option value={PRICING_MODE.DUTCH}>Import Dutch result</option>
                                </SelectInput>
                            </Field>
                        </div>

                        <Button type="submit" size="lg" isLoading={submitting} disabled={platform?.paused || !platform?.initialized}>
                            Create RFQ
                        </Button>
                    </form>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Review">
                        <DataGrid columns={2}>
                            <DataPoint label="Current block" value={currentBlock ?? 'Unavailable'} />
                            <DataPoint label="Bid window" value={bidWindow > 0 ? `${bidWindow} blocks` : '--'} subtle={bidWindow > 0 ? `~${formatBlockTime(bidWindow)}` : undefined} />
                            <DataPoint label="Reveal window" value={revealWindow > 0 ? `${revealWindow} blocks` : '--'} subtle={revealWindow > 0 ? `~${formatBlockTime(revealWindow)}` : undefined} />
                            <DataPoint label="Minimum bid" value={minBidMicro ? formatAmount(minBidMicro, Number(tokenType)) : '--'} />
                            <DataPoint label="Pricing mode" value={pricingLabel(Number(pricingMode))} />
                            <DataPoint label="Platform fee" value={Number(tokenType) === TOKEN_TYPE.USAD ? 'No fee on USAD' : `${platform?.feeBps ?? 0} bps`} />
                        </DataGrid>
                    </Panel>

                    <Panel title="What happens next">
                        <div className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                            <div>The app generates a random field salt and derives the RFQ id in the browser before submission.</div>
                            <div>
                                {Number(pricingMode) === PRICING_MODE.RFQ
                                    ? 'This RFQ will accept sealed bid commits and later move into the reveal and winner-selection flow.'
                                    : `This RFQ will stay open until you import a finalized ${pricingLabel(Number(pricingMode))} auction result.`}
                            </div>
                            <div>USAD settlement uses zero fees. ALEO and USDCx use the current platform basis points.</div>
                        </div>
                    </Panel>
                </div>
            </div>
        </PageShell>
    );
}
