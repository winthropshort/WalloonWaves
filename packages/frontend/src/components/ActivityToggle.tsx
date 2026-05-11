import type { ActivityMode } from '@walloon/shared';

interface Props {
  value:    ActivityMode;
  onChange: (m: ActivityMode) => void;
}

export function ActivityToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-full border border-walloon-blue-200 bg-white p-1 shadow-sm">
      {(['dock', 'mariner'] as const).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={[
              'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-walloon-blue-500 text-white shadow-sm'
                : 'text-walloon-blue-500 hover:bg-walloon-blue-50',
            ].join(' ')}
          >
            {mode === 'mariner' ? '⛵ Mariner' : '🔧 Dock Installer'}
          </button>
        );
      })}
    </div>
  );
}
