import { api, Court } from '@/lib/api';
import Link from 'next/link';

const CLUB_ID = 'club-demo';

export default async function CourtsPage() {
  let courts: Court[] = [];
  try {
    courts = await api.getCourts(CLUB_ID);
  } catch {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-red-600">Impossible de charger les terrains.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">
        {courts[0]?.club.name ?? 'PadelConnect'}
      </h1>

      <div className="grid gap-4">
        {courts.map((court) => (
          <Link
            key={court.id}
            href={`/courts/${court.id}`}
            className="flex items-center justify-between rounded-xl border bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div>
              <div className="font-semibold">{court.name}</div>
              <div className="text-sm text-gray-500 capitalize">{court.surface}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-green-700">{court.pricePerHour} €/h</div>
              <div className="text-sm text-gray-400">
                {court.openHour}h – {court.closeHour}h
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
