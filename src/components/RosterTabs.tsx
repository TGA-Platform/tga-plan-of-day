import { Link, useLocation } from 'react-router-dom';

interface RosterTabsProps {
  centreId: string;
}

export default function RosterTabs({ centreId }: RosterTabsProps) {
  const location = useLocation();
  const path = location.pathname;

  const tabs = [
    { key: 'roster', label: 'Roster', to: '/roster' },
    { key: 'timesheets', label: 'Timesheets', to: '/timesheets' },
    { key: 'kiosk', label: 'Kiosk', to: `/kiosk-settings?centre=${encodeURIComponent(centreId)}` },
  ];

  return (
    <div className="flex items-center gap-1 mb-4 border-b" style={{ borderColor: '#E2F1DA' }}>
      {tabs.map(tab => {
        const isActive = tab.key === 'kiosk'
          ? path.startsWith('/kiosk')
          : path.startsWith(tab.to);
        return (
          <Link
            key={tab.key}
            to={tab.to}
            className="px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              color: isActive ? '#2d5c18' : '#596570',
              borderBottom: isActive ? '2px solid #5a9228' : '2px solid transparent',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
