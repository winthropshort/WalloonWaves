import { Routes, Route } from 'react-router-dom';

function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#F5F5F0' }}>
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-4xl font-bold mb-2" style={{ color: '#1B4F72' }}>
          WalloonWaves
        </h1>
        <p className="text-lg mb-8" style={{ color: '#1E5631' }}>
          Wave height prediction for Walloon Lake
        </p>
        <div className="rounded-2xl p-8 shadow-sm border border-gray-200" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-gray-500">
            Wave forecasts coming soon — Phase 2 &amp; 3 in progress.
          </p>
        </div>
        <footer className="mt-8 text-sm text-gray-400">
          Powered by{' '}
          <a
            href="https://www.weather.gov"
            className="underline hover:text-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            NWS data
          </a>
          {' · '}
          <a
            href="https://walloon.org"
            className="underline hover:text-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            walloon.org
          </a>
        </footer>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
