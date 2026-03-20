import { redirect } from 'next/navigation';

export default function SelectWinnerRedirect({ params }: { params: { id: string } }) {
    redirect(`/buyer/rfqs/${encodeURIComponent(params.id)}`);
}
