import { redirect } from 'next/navigation';

export default function FundEscrowRedirect({ params }: { params: { id: string } }) {
    redirect(`/buyer/rfqs/${encodeURIComponent(params.id)}`);
}
