import type { SVGProps } from 'react';

/**
 * Inline SVG icons, replacing the Font Awesome 4.7 CDN stylesheet that was
 * loaded in `index.html`. That was a render-blocking third-party request and a
 * supply-chain dependency for what amounts to twenty small paths.
 *
 * Icons are decorative by default (`aria-hidden`); the accessible name belongs
 * on the control that contains them.
 */
export type IconName =
  | 'search'
  | 'star'
  | 'star-filled'
  | 'star-half'
  | 'plus'
  | 'close'
  | 'trash'
  | 'edit'
  | 'share'
  | 'sun'
  | 'moon'
  | 'chevron-left'
  | 'chevron-right'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'list-ul'
  | 'list-ol'
  | 'heading'
  | 'quote'
  | 'book'
  | 'folder'
  | 'user'
  | 'check'
  | 'warning'
  | 'clock'
  | 'knife'
  | 'flame'
  | 'users'
  | 'gauge'
  | 'globe'
  | 'minus'
  | 'cart'
  | 'printer'
  | 'expand'
  | 'keyboard'
  | 'arrow-up'
  | 'sparkles'
  | 'history'
  | 'play';

const PATHS: Record<IconName, string> = {
  search: 'M11 3a8 8 0 1 0 4.9 14.32l4.39 4.39 1.42-1.42-4.39-4.39A8 8 0 0 0 11 3Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z',
  star: 'M12 4.6l2.2 4.46 4.92.72-3.56 3.47.84 4.9L12 15.84l-4.4 2.31.84-4.9-3.56-3.47 4.92-.72L12 4.6Zm0-3.6L8.7 7.68 1.31 8.76l5.35 5.21-1.27 7.36L12 17.86l6.61 3.47-1.27-7.36 5.35-5.21-7.39-1.08L12 1Z',
  'star-filled': 'M12 1l3.3 6.68 7.39 1.08-5.35 5.21 1.27 7.36L12 17.86l-6.61 3.47 1.27-7.36L1.31 8.76 8.7 7.68 12 1Z',
  'star-half':
    'M12 1v16.86l-6.61 3.47 1.27-7.36L1.31 8.76 8.7 7.68 12 1Zm0 3.6v11.24l4.4 2.31-.84-4.9 3.56-3.47-4.92-.72L12 4.6Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  close: 'M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42Z',
  trash:
    'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  share:
    'M18 16.08a2.9 2.9 0 0 0-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.53.48 1.22.78 1.99.78a3 3 0 1 0-3-3c0 .24.04.47.09.7L7.99 9.78A3 3 0 1 0 6 15.22l7.12 4.16c-.05.21-.08.43-.08.66a2.92 2.92 0 1 0 4.96-2.09v.13Z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.22 2.81 6.34 4.93 4.93 6.34 2.81 4.22l1.41-1.41Zm12.85 12.85 2.12 2.12-1.41 1.41-2.12-2.12 1.41-1.41Zm2.12-13.44 1.41 1.41-2.12 2.12-1.41-1.41 2.12-2.12ZM6.34 17.66l1.41 1.41-2.12 2.12-1.41-1.41 2.12-2.12Z',
  moon: 'M12.34 2.02a10 10 0 1 0 9.64 12.34A8 8 0 0 1 12.34 2.02Z',
  'chevron-left': 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z',
  'chevron-right': 'M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12l-4.58 4.59Z',
  bold: 'M7 4h5.5a4 4 0 0 1 2.9 6.75A4.25 4.25 0 0 1 13.25 19H7V4Zm3 2v4h2.5a2 2 0 1 0 0-4H10Zm0 6v5h3.25a2.5 2.5 0 0 0 0-5H10Z',
  italic: 'M10 4h8v2h-2.86l-3 12H14v2H6v-2h2.86l3-12H10V4Z',
  strike: 'M3 11h18v2H3v-2Zm9-7c2.8 0 4.7 1.35 5.2 3.5l-2 .4C14.9 6.7 13.7 6 12 6c-1.9 0-3 .8-3 1.9 0 .5.2.9.6 1.2H6.4A3.4 3.4 0 0 1 6 7.6C6 5.4 8.4 4 12 4Zm-3.4 11c.3 1.9 1.6 3 3.4 3 2 0 3.2-.9 3.2-2.2 0-.6-.2-1.1-.6-1.5h2.3c.3.5.4 1.1.4 1.7 0 2.4-2.1 4-5.3 4-3.4 0-5.6-1.7-6-4.4l2.6-.6Z',
  'list-ul':
    'M4 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm5 -1h12v2H9v-2Zm-5 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm5 -1h12v2H9v-2Zm-5 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm5 -1h12v2H9v-2Z',
  'list-ol':
    'M3 5h1v3H3v1h3V8H5V5c0-.6-.4-1-1-1H3v1Zm6 .5h12v2H9v-2ZM3 11h2l-2 2.5V15h3v-1H4l2-2.5V10H3v1Zm6 .5h12v2H9v-2ZM3 17h2v.5H4v1h1v.5H3v1h2c.6 0 1-.4 1-1v-2c0-.6-.4-1-1-1H3v1Zm6 .5h12v2H9v-2Z',
  heading: 'M5 4h2v6h6V4h2v16h-2v-8H7v8H5V4Z',
  quote:
    'M7 7h4v4a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2H7V7Zm7 0h4v4a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2h-2V7Z',
  book: 'M4 3h11a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V3Zm2 2v10h10a4 4 0 0 1 0 0V6a1 1 0 0 0-1-1H6Zm12 14v2H5a3 3 0 0 1-3-3V4h2v14a1 1 0 0 0 1 1h13Z',
  folder: 'M3 5h6l2 2h10v12H3V5Zm2 2v10h14V9h-8.83l-2-2H5Z',
  user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z',
  warning: 'M12 2 1 21h22L12 2Zm0 4.5L19.5 19h-15L12 6.5ZM11 10v5h2v-5h-2Zm0 6v2h2v-2h-2Z',
  clock:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3v6l5 3 1-1.73-4-2.4V7h-2Z',
  knife: 'M3 3h2l10 10-2 2L3 5V3Zm12.5 10.5 2.5 2.5-1.5 1.5 3 3-1.5 1.5-3-3L13.5 21 11 18.5l4.5-5Z',
  flame:
    'M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.6-3 1.4-4.2C8 8.6 9 9.4 9.6 10c.3-2.8 1.4-6 2.4-8Zm0 16a3 3 0 0 0 3-3c0-1.2-.6-2.4-1.4-3.5-.5.7-1.1 1.2-1.6 1.6-.4-.6-1-1.3-1.6-2A5.6 5.6 0 0 0 9 15a3 3 0 0 0 3 3Z',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 1.8-6 4v3h12v-3c0-2.2-2.7-4-6-4Zm8-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm.5 2c-.6 0-1.2.1-1.7.2A6 6 0 0 1 17 17v3h4v-3c0-2-1.6-4-3.5-4Z',
  gauge:
    'M12 4a9 9 0 0 0-7.9 13.3l1.8-1A7 7 0 1 1 18.1 16.3l1.8 1A9 9 0 0 0 12 4Zm4.2 4.4-4 3.6a1.8 1.8 0 1 0 1.4 1.4l3.6-4-1-1Z',
  globe:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 7h-2.6a15 15 0 0 0-1.3-4.1A8 8 0 0 1 18.9 9ZM12 4.1c.7 1 1.5 2.6 1.9 4.9h-3.8c.4-2.3 1.2-3.9 1.9-4.9ZM4.3 14a8 8 0 0 1 0-4h3a17 17 0 0 0 0 4h-3Zm.8 2h2.6c.3 1.5.8 2.9 1.3 4.1A8 8 0 0 1 5.1 16Zm2.6-7H5.1a8 8 0 0 1 3.9-4.1A15 15 0 0 0 7.7 9ZM12 19.9c-.7-1-1.5-2.6-1.9-4.9h3.8c-.4 2.3-1.2 3.9-1.9 4.9ZM14.2 13H9.8a15 15 0 0 1 0-4h4.4a15 15 0 0 1 0 4Zm.8 7.1c.5-1.2 1-2.6 1.3-4.1h2.6a8 8 0 0 1-3.9 4.1ZM16.7 14a17 17 0 0 0 0-4h3a8 8 0 0 1 0 4h-3Z',
  minus: 'M5 11h14v2H5v-2Z',
  cart: 'M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 2h3.3l.9 4H21a1 1 0 0 1 1 1.2l-1.6 7A2 2 0 0 1 18.4 16H7.6a2 2 0 0 1-2-1.6L3.3 4H1V2Zm4.7 6 1.3 6h11.2l1.4-6H5.7Z',
  printer:
    'M7 3h10v4H7V3ZM5 9h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2Zm4 8v2h6v-2H9Zm8-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  expand: 'M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z',
  keyboard:
    'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h16V7H4Zm2 2h2v2H6V9Zm3 0h2v2H9V9Zm3 0h2v2h-2V9Zm3 0h3v2h-3V9ZM6 12h2v2H6v-2Zm3 0h6v2H9v-2Zm7 0h2v2h-2v-2ZM8 15h8v2H8v-2Z',
  'arrow-up': 'M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8l-4.6 4.6L5 11l7-7Z',
  sparkles:
    'M12 2l1.8 4.7L18.5 8.5l-4.7 1.8L12 15l-1.8-4.7L5.5 8.5l4.7-1.8L12 2Zm6 10l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3ZM6 14l.8 2 2 .8-2 .8L6 19.6l-.8-2-2-.8 2-.8L6 14Z',
  history:
    'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 4.9l-1.4 1.5A9 9 0 1 0 13 3Zm-1 4v6l5 2.9.8-1.7-3.8-2.2V7H12Z',
  play: 'M8 5v14l11-7L8 5Z',
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Provide only when the icon is the sole content of a non-labelled element. */
  title?: string;
}

export function Icon({ name, size = 20, title, ...props }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
