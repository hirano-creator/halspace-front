// ナビゲーション用のアイコン（線画・16px 前後で使う想定）

type Props = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconHome = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
  </svg>
);

export const IconCustomer = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

export const IconVisit = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const IconSchool = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 15c3-3 6 3 9 0s6-3 9 0" />
    <path d="M3 9c3-3 6 3 9 0s6-3 9 0" />
  </svg>
);

export const IconCalendar = ({ className }: Props) => (
  <svg {...base} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IconProduct = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
    <path d="M8 7a4 4 0 0 1 8 0" />
  </svg>
);

export const IconFollow = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 8v5l3 2" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

export const IconChart = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconStaff = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6M17 11h5M19.5 8.5v5" />
  </svg>
);

export const IconSettings = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
);

export const IconMenu = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconSearch = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconClose = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
