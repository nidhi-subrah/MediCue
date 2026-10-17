/**
 * Line icons drawn for SilentSignal, one per tap option plus a few controls. 24 x 24 grid,
 * 1.75 stroke, currentColor, so they inherit text colour in both themes. Emoji render differently on
 * every tablet; these don't.
 */
const PATHS: Record<string, JSX.Element> = {
  // body areas
  head: <><circle cx="12" cy="9.5" r="6" /><path d="M9.5 15.2 9 21M14.5 15.2 15 21" /></>,
  chest: <><path d="M6.5 4C5 7.5 4.6 12 5.2 20h13.6c.6-8 .2-12.5-1.3-16" /><path d="M12 4v16M8 9h2.5M13.5 9H16M8 13h2.5M13.5 13H16" /></>,
  belly: <><path d="M6.5 3C5.2 7.5 4.8 13 6 21h12c1.2-8 .8-13.5-.5-18" /><circle cx="12" cy="13" r="1.1" /></>,
  back: <><path d="M12 3v18" /><path d="M9 5.5h6M8.5 9.5h7M8.5 13.5h7M9 17.5h6" /></>,
  arms_legs: <><path d="M7 3v7.5L5.5 21M17 3v7.5L18.5 21" /><path d="M7 10.5h10" /></>,
  surgical_site: <><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="M10.6 11.3h.01M13.4 12.7h.01M12.7 10.6h.01M11.3 13.4h.01" strokeWidth="2.4" /></>,
  mouth_throat: <><path d="M3.5 11.5c3-2.5 14-2.5 17 0-3 4.5-14 4.5-17 0Z" /><path d="M3.5 11.5h17" /></>,
  whole_body: <><circle cx="12" cy="4.5" r="2" /><path d="M12 7.5v7M7.5 10l4.5-1 4.5 1M9 21l3-6.5 3 6.5" /></>,
  toilet: <><path d="M6.5 3h5v7h-5zM4 10h16c0 3.6-2.7 6-6 6l.8 5H9.2l.8-5c-3.3 0-6-2.4-6-6Z" /></>,
  people: <><path d="M4 5h16v10.5h-9l-4.5 4v-4H4Z" /><path d="M8 9.5h8M8 12h5" /></>,
  // feelings
  pain: <path d="M13.5 2 6 13h5l-1.5 9L18 10.5h-5.2Z" />,
  hard_to_breathe: <path d="M3 9h11a3 3 0 1 0-3-3M3 15h14.5a3 3 0 1 1-3 3M3 12h7.5" />,
  too_hot: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  too_cold: <path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" />,
  thirsty: <path d="M12 3c4 5 6 8.3 6 11.2a6 6 0 0 1-12 0C6 11.3 8 8 12 3Z" />,
  hungry: <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.5 1.5-3.5 5-3.5 8.5H17" />,
  need_toilet: <><path d="M6.5 3h5v7h-5zM4 10h16c0 3.6-2.7 6-6 6l.8 5H9.2l.8-5c-3.3 0-6-2.4-6-6Z" /></>,
  sick: <><circle cx="12" cy="12" r="9" /><path d="M8.5 9.5h.01M15.5 9.5h.01" strokeWidth="2.6" /><path d="M7.5 15.5c1-1 2-1 3 0s2 1 3 0 2-1 3 0" /></>,
  uncomfortable: <><path d="M3 19V7M3 15h18v4M21 15v-2.5A2.5 2.5 0 0 0 18.5 10H11v5" /><circle cx="7" cy="12" r="1.8" /></>,
  scared: <><circle cx="12" cy="12" r="9" /><path d="M8 8.5 10 9.5M16 8.5 14 9.5" /><path d="M9 12h.01M15 12h.01" strokeWidth="2.6" /><ellipse cx="12" cy="16.2" rx="2" ry="1.6" /></>,
  want_someone: <><circle cx="9" cy="7.5" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6M15 14.3c3 0 5.5 2 5.5 5.7" /></>,
  medicine: <><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="m9.5 9.5 5 5" /></>,
  not_sure: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 16.8h.01" /></>,
  // controls
  yes: <path d="m4.5 12.5 4.8 4.8L19.5 7" />,
  no: <path d="M6 6l12 12M18 6 6 18" />,
  unsure: <path d="M5 12h14" />,
  again: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 3.5v4h4" /></>,
  forward: <path d="M5 12h14M13 6l6 6-6 6" />,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 4.8 4.8L19.5 7" />,
  alert: <><path d="M12 3.5 2.5 20h19Z" /><path d="M12 10v4.5M12 17.2h.01" /></>,
};

export default function Icon({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const body = PATHS[name] ?? PATHS.not_sure;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {body}
    </svg>
  );
}
