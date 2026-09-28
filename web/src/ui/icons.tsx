import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const MicOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 9V6a3 3 0 0 1 5.8-1M15 10v1a3 3 0 0 1-4.6 2.5" />
    <path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" />
  </Svg>
);

export const SpeakerIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </Svg>
);

export const SpeakerOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M17 9l5 6M22 9l-5 6" />
  </Svg>
);

export const CrownIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

export const DoorIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4H6v16h8M10 12h10M17 9l3 3-3 3" />
  </Svg>
);

export const NoVoiceIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" />
    <path d="M3 3l18 18" />
  </Svg>
);

export const RotatePhoneIcon = (p: P) => (
  <Svg {...p} viewBox="0 0 48 48">
    <rect x="15" y="6" width="18" height="32" rx="3.5" />
    <path d="M22 33h4" />
    <path d="M38 20a14 14 0 0 1-4 14M34 34l.2-4.6M34 34l-4.5-.5" />
  </Svg>
);

export const BotIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" />
    <circle cx="12" cy="3.5" r="1" fill="currentColor" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const ExpandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
