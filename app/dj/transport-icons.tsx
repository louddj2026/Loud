export function PlayTransportIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-play" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M8 4.5v39L42 24 8 4.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseTransportIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-pause" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="7" y="4" width="13" height="40" rx="1.5" fill="currentColor" />
      <rect x="28" y="4" width="13" height="40" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function PlayCueTransportIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-play-cue" viewBox="0 0 64 56" aria-hidden="true" focusable="false">
      <path d="M4 7v38l32-19L4 7Z" fill="currentColor" />
      <path d="m43 7-14 12 14 12v-8h2.5C52.4 23 58 28.6 58 35.5S52.4 48 45.5 48H23v7h22.5C56.1 55 62 46.3 62 35.5S56.1 16 45.5 16H43V7Z" fill="currentColor" />
    </svg>
  );
}

export function LoopTransportIcon() {
  return (
    <svg className="loop-transport-icon" viewBox="0 0 120 78" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M16 2h88c8.8 0 16 7.2 16 16v42c0 8.8-7.2 16-16 16H16C7.2 76 0 68.8 0 60V18C0 9.2 7.2 2 16 2Zm0 6C10.5 8 6 12.5 6 18v42c0 5.5 4.5 10 10 10h88c5.5 0 10-4.5 10-10V18c0-5.5-4.5-10-10-10H16Z" />
      <path d="M22 42c0-12.2 9.8-22 22-22h13v9H44c-7.2 0-13 5.8-13 13v4h10L26.5 62 12 46h10v-4Zm76-6c0 12.2-9.8 22-22 22H63v-9h13c7.2 0 13-5.8 13-13v-4H79l14.5-16L108 32H98v4Z" fill="currentColor" />
    </svg>
  );
}

export function ZoomOutIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-compact transport-action-icon-zoom-out" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M20 3a17 17 0 1 0 10.6 30.3l10.8 10.8a4 4 0 0 0 5.7-5.7L36.3 27.6A17 17 0 0 0 20 3Zm0 7a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
      <path d="M12 17h16v6H12z" fill="currentColor" />
    </svg>
  );
}

export function ZoomInIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-compact transport-action-icon-zoom-in" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M20 3a17 17 0 1 0 10.6 30.3l10.8 10.8a4 4 0 0 0 5.7-5.7L36.3 27.6A17 17 0 0 0 20 3Zm0 7a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
      <path d="M17 12h6v5h5v6h-5v5h-6v-5h-5v-6h5v-5Z" fill="currentColor" />
    </svg>
  );
}

export function HeadphoneIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-compact transport-action-icon-headphone" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M24 4C12.4 4 3 13.4 3 25v8h8v-8c0-7.2 5.8-13 13-13s13 5.8 13 13v8h8v-8C45 13.4 35.6 4 24 4Z" fill="currentColor" />
      <path d="M4 27h12v17H9a5 5 0 0 1-5-5V27Zm28 0h12v12a5 5 0 0 1-5 5h-7V27Z" fill="currentColor" />
    </svg>
  );
}

export function PitchDownIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-compact transport-action-icon-pitch-down" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M4 9h20v7H4V9Zm28-5h8v25h7L36 44 25 29h7V4Z" fill="currentColor" />
    </svg>
  );
}

export function PitchUpIcon() {
  return (
    <svg className="transport-action-icon transport-action-icon-compact transport-action-icon-pitch-up" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M10.5 4H17v6.5h6.5V17H17v6.5h-6.5V17H4v-6.5h6.5V4ZM36 4l11 15h-7v25h-8V19h-7L36 4Z" fill="currentColor" />
    </svg>
  );
}

export function ReturnToCueIcon() {
  return <svg className="transport-action-icon transport-action-icon-return-cue" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M8 10v28M37 12v9a9 9 0 0 1-9 9H18m7-8-8 8 8 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
