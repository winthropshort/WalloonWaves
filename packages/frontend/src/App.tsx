import { useState } from 'react';
import type { ActivityMode } from '@walloon/shared';
import { useLocations } from './hooks/useLocations.js';
import { useWeatherHistory } from './hooks/useWeatherHistory.js';
import { ActivityToggle } from './components/ActivityToggle.js';
import { LocationCard } from './components/LocationCard.js';
import { GeocodeSection } from './components/GeocodeSection.js';

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 space-y-4 animate-pulse">
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-12 bg-gray-100 rounded w-1/2" />
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-14 bg-gray-50 rounded" />
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export default function App() {
  const [activity, setActivity] = useState<ActivityMode>('mariner');

  const { data: locations, isLoading: locsLoading, error: locsError, dataUpdatedAt } = useLocations();
  const { data: history = [] } = useWeatherHistory(48);

  const currentObs = history.length
    ? [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null
    : null;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F5F0' }}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-walloon-blue-600 tracking-tight">
            WalloonWaves
          </h1>
          <p className="text-sm text-walloon-green-600 font-medium">
            Walloon Lake, Michigan
          </p>
          {lastUpdated && (
            <p className="text-xs text-gray-400">Last checked {lastUpdated}</p>
          )}
        </header>

        <div className="flex justify-center">
          <ActivityToggle value={activity} onChange={setActivity} />
        </div>

        {activity === 'dock' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 max-w-2xl mx-auto">
            <strong>Dock Installer View</strong> — Assembly phase requires waves &lt; 0.75 ft
            (pre-whitecap). Jetting phase tolerates up to 1.5 ft once the dock is fully assembled.
          </div>
        )}

        {locsError && (
          <ErrorBanner message="Unable to load wave conditions. Check your connection and try again." />
        )}
        {locsLoading && <LoadingSkeleton />}
        {locations && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((loc) => (
              <LocationCard
                key={loc.id}
                location={loc}
                activity={activity}
                history={history}
              />
            ))}
          </div>
        )}

        <GeocodeSection activity={activity} currentObs={currentObs} />

        <footer className="text-center text-xs text-gray-400 pt-4 border-t border-gray-200 space-y-1">
          <p>
            Wave model: CERC/SPM fetch-limited —{' '}
            <span className="font-mono">H_s = 0.00162√(U_A²·F/g)</span>
          </p>
          <p>
            Powered by{' '}
            <a href="https://www.weather.gov" target="_blank" rel="noopener noreferrer"
               className="underline hover:text-gray-600">NWS hourly forecast</a>
            {' · '}
            <a href="https://walloon.org" target="_blank" rel="noopener noreferrer"
               className="underline hover:text-gray-600">walloon.org</a>
          </p>
        </footer>

      </div>
    </div>
  );
}
