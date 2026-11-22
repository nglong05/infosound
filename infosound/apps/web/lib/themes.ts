/** Local, allowlisted dark palettes. Values are color tokens only, never arbitrary CSS. */
type HexColor = `#${string}`;
type Palette = {
  bg: HexColor;
  panel: HexColor;
  elevated: HexColor;
  text: HexColor;
  muted: HexColor;
  accent: HexColor;
  hover: HexColor;
  ink: HexColor;
  line: HexColor;
};
type Tokens = Readonly<Record<`--${string}`, HexColor>>;
function mix(a: HexColor, b: HexColor, amount: number): HexColor {
  return ('#' +
    [1, 3, 5]
      .map((index) =>
        Math.round(
          parseInt(a.slice(index, index + 2), 16) * (1 - amount) +
            parseInt(b.slice(index, index + 2), 16) * amount,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')) as HexColor;
}
function alpha(color: HexColor, opacity: string): HexColor {
  return `#${color.slice(1, 7)}${opacity}`;
}
function luminance(color: HexColor): number {
  return [1, 3, 5].reduce((sum, index, channel) => {
    const value = parseInt(color.slice(index, index + 2), 16) / 255;
    return (
      sum +
      [0.2126, 0.7152, 0.0722][channel] *
        (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}
function readableFill(candidate: HexColor, foreground: HexColor, base: HexColor): HexColor {
  for (let step = 0; step <= 25; step++) {
    const color = mix(candidate, base, step / 25),
      a = luminance(foreground),
      b = luminance(color);
    if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.6) return color;
  }
  return base;
}
function palette(p: Palette, overrides: Tokens = {}): Tokens {
  const control = mix(p.line, p.text, 0.25),
    hero = mix(p.bg, p.accent, 0.2);
  return Object.freeze({
    '--bg': p.bg,
    '--panel': p.panel,
    '--elevated': p.elevated,
    '--text': p.text,
    '--muted': p.muted,
    '--accent': p.accent,
    '--accent-hover': p.hover,
    '--ink': p.ink,
    '--line': p.line,
    '--surface-hover': mix(p.elevated, p.accent, 0.055),
    '--accent-soft': mix(p.bg, p.accent, 0.13),
    '--text-soft': mix(p.text, p.muted, 0.5),
    '--placeholder': mix(p.muted, p.panel, 0.1),
    '--border-soft': mix(p.bg, p.line, 0.65),
    '--control-border': control,
    '--control-hover': mix(control, p.text, 0.12),
    '--control-strong': mix(control, p.text, 0.28),
    '--focus': p.text,
    '--link': mix(p.hover, p.text, 0.2),
    '--link-hover': mix(p.hover, p.text, 0.65),
    '--sidebar-bg': mix(p.bg, p.panel, 0.6),
    '--header-bg': alpha(p.bg, 'f2'),
    '--player-bg': mix(p.bg, p.panel, 0.5),
    '--mobile-nav-bg': alpha(mix(p.bg, p.panel, 0.4), 'f5'),
    '--body-glow': alpha(hero, '28'),
    '--accent-shadow': alpha(p.accent, '20'),
    '--accent-wash': alpha(p.accent, '18'),
    '--accent-wash-soft': alpha(p.accent, '12'),
    '--accent-wash-faint': alpha(p.accent, '09'),
    '--accent-edge': alpha(p.accent, '30'),
    '--active-bg': mix(p.panel, p.accent, 0.13),
    '--hero-start': hero,
    '--hero-middle': mix(p.bg, p.accent, 0.12),
    '--hero-end': mix(p.bg, p.accent, 0.07),
    '--hero-border': alpha(mix(p.line, p.accent, 0.2), '66'),
    '--hero-glow': alpha(p.hover, '38'),
    '--hero-eyebrow': mix(p.text, p.accent, 0.13),
    '--hero-highlight': mix(p.text, p.accent, 0.36),
    '--hero-copy': mix(p.text, p.muted, 0.35),
    '--visual-glow': alpha(p.hover, '1f'),
    '--visual-caption': mix(p.text, p.muted, 0.25),
    '--record-dark': mix(p.bg, p.panel, 0.15),
    '--record-mid': mix(p.elevated, p.accent, 0.025),
    '--record-low': mix(p.bg, p.panel, 0.7),
    '--record-border': alpha(control, '80'),
    '--record-label-start': mix(p.elevated, p.accent, 0.3),
    '--record-label-end': mix(p.bg, p.accent, 0.22),
    '--record-label-border': alpha(mix(control, p.hover, 0.3), '80'),
    '--record-hole': mix(p.bg, p.panel, 0.25),
    '--record-hole-border': mix(p.text, p.accent, 0.3),
    '--soundbar-top': mix(p.text, p.accent, 0.35),
    '--soundbar-bottom': mix(p.accent, p.bg, 0.18),
    '--avatar-start': readableFill(mix(control, p.accent, 0.12), p.text, p.panel),
    '--avatar-end': mix(p.bg, p.accent, 0.15),
    '--avatar-border': alpha(control, '55'),
    '--avatar-text': p.text,
    '--empty-start': mix(p.panel, p.accent, 0.18),
    '--empty-end': mix(p.bg, p.accent, 0.08),
    '--empty-border': alpha(control, '44'),
    '--empty-text': mix(p.text, p.accent, 0.25),
    '--skeleton-highlight': mix(p.elevated, p.text, 0.08),
    '--codec-bg': alpha(p.bg, 'e6'),
    '--codec-text': p.text,
    '--detail-start': mix(p.panel, p.accent, 0.12),
    '--artist-start': readableFill(mix(control, p.hover, 0.2), p.text, p.panel),
    '--artist-end': mix(p.panel, p.accent, 0.13),
    '--artwork-start': mix(p.elevated, p.accent, 0.28),
    '--artwork-end': mix(p.bg, p.accent, 0.08),
    '--playlist-start': mix(p.panel, p.accent, 0.2),
    '--playlist-end': mix(p.bg, p.accent, 0.1),
    '--playlist-glow': alpha(control, '66'),
    '--playlist-edge': alpha(p.accent, '2b'),
    '--playlist-text': mix(p.text, p.accent, 0.08),
    '--notification-bg': mix(p.panel, p.accent, 0.06),
    '--auth-record-dark': mix(p.bg, p.panel, 0.25),
    '--auth-record-mid': mix(p.elevated, p.accent, 0.045),
    '--auth-record-low': mix(p.bg, p.panel, 0.8),
    '--auth-record-edge': control,
    '--auth-label-start': mix(p.panel, p.accent, 0.26),
    '--auth-label-end': mix(control, p.hover, 0.25),
    '--step-border': control,
    '--file-border': mix(control, p.text, 0.13),
    '--file-hover': mix(p.bg, p.accent, 0.06),
    '--file-selected': mix(p.bg, p.accent, 0.12),
    '--mini-start': mix(p.panel, p.accent, 0.22),
    '--mini-end': mix(p.bg, p.accent, 0.12),
    // Status meaning remains stable even when the decorative accent is red or purple.
    '--danger': '#ffb4bd',
    '--danger-surface': '#3e1c25',
    '--danger-border': '#995664',
    '--danger-hover': '#582736',
    '--danger-text': '#ffe9ed',
    '--danger-zone': '#201217',
    '--success': '#9af7bd',
    '--success-surface': '#163922',
    '--success-border': '#519566',
    '--success-soft': '#133a24',
    '--success-text': '#d7ffe4',
    '--processing': '#d0c9ff',
    '--processing-surface': '#292341',
    '--processing-border': '#74659c',
    ...overrides,
  });
}

export const themes = [
  {
    id: 'forest',
    name: 'Xanh lá',
    preview: '#47ed8b',
    tokens: palette(
      {
        bg: '#090d0b',
        panel: '#141b17',
        elevated: '#202a24',
        text: '#f5f8f6',
        muted: '#b6c2ba',
        accent: '#47ed8b',
        hover: '#7af5ab',
        ink: '#07160c',
        line: '#36483d',
      },
      {
        '--surface-hover': '#25332b',
        '--accent-soft': '#133a24',
        '--text-soft': '#d4ddd7',
        '--placeholder': '#a3b0a8',
        '--border-soft': '#25362c',
        '--control-border': '#607666',
        '--control-hover': '#6d8876',
        '--control-strong': '#819789',
        '--link': '#91f5b7',
        '--link-hover': '#cbffde',
        '--sidebar-bg': '#101813',
        '--header-bg': '#090d0bf2',
        '--player-bg': '#0f1712',
        '--mobile-nav-bg': '#0d1510f5',
        '--body-glow': '#16392328',
        '--active-bg': '#1c3927',
        '--hero-start': '#183d26',
        '--hero-middle': '#142c1d',
        '--hero-end': '#101c14',
        '--hero-border': '#37644866',
        '--hero-glow': '#5dfb9838',
        '--hero-eyebrow': '#d0e8d7',
        '--hero-highlight': '#a3fac3',
        '--hero-copy': '#c8ddcf',
        '--visual-glow': '#86e7a81f',
        '--visual-caption': '#c7e0cf',
        '--record-dark': '#0b100d',
        '--record-mid': '#2a342d',
        '--record-low': '#111b14',
        '--record-border': '#6e8e7780',
        '--record-label-start': '#477e59',
        '--record-label-end': '#183f27',
        '--record-label-border': '#82bb9480',
        '--record-hole': '#0b140e',
        '--record-hole-border': '#b5d8be',
        '--soundbar-top': '#a6fac5',
        '--soundbar-bottom': '#49c57c',
        '--avatar-start': '#4c7961',
        '--avatar-end': '#1d3a29',
        '--avatar-border': '#79ad8b55',
        '--avatar-text': '#f2fff6',
        '--empty-start': '#284e35',
        '--empty-end': '#15271b',
        '--empty-border': '#78ac8a44',
        '--empty-text': '#aff3c7',
        '--skeleton-highlight': '#314138',
        '--codec-bg': '#09130de6',
        '--codec-text': '#eefbf1',
        '--detail-start': '#23412d',
        '--artist-start': readableFill('#6c9c7b', '#f2fff6', '#141b17'),
        '--artist-end': '#25422e',
        '--playlist-start': '#294f37',
        '--playlist-end': '#13281c',
        '--playlist-glow': '#69937c66',
        '--playlist-edge': '#8ac69b2b',
        '--playlist-text': '#d5f9e1',
        '--notification-bg': '#16271c',
        '--auth-record-dark': '#0d160f',
        '--auth-record-mid': '#2b3b2f',
        '--auth-record-low': '#111e15',
        '--auth-record-edge': '#5a7e63',
        '--auth-label-start': '#345f41',
        '--auth-label-end': '#80b591',
        '--step-border': '#63866e',
        '--file-border': '#6f967b',
        '--file-hover': '#102217',
        '--file-selected': '#11321e',
        '--mini-start': '#31583b',
        '--mini-end': '#172b1e',
      },
    ),
  },
  {
    id: 'red',
    name: 'Đỏ trầm',
    preview: '#ff7b85',
    tokens: palette({
      bg: '#100b0c',
      panel: '#211619',
      elevated: '#302126',
      text: '#fff5f5',
      muted: '#d2b8bf',
      accent: '#ff7b85',
      hover: '#ffa6ad',
      ink: '#290b13',
      line: '#503039',
    }),
  },
  {
    id: 'orange',
    name: 'Cam đất',
    preview: '#f3a96d',
    tokens: palette({
      bg: '#110e0b',
      panel: '#201a14',
      elevated: '#30261d',
      text: '#fff7ef',
      muted: '#cebead',
      accent: '#f3a96d',
      hover: '#ffc79e',
      ink: '#241307',
      line: '#51402c',
    }),
  },
  {
    id: 'pink',
    name: 'Hồng dịu',
    preview: '#f39ac5',
    tokens: palette({
      bg: '#110c10',
      panel: '#20171e',
      elevated: '#31222d',
      text: '#fff4fb',
      muted: '#cebccc',
      accent: '#f39ac5',
      hover: '#ffc0dd',
      ink: '#2a1021',
      line: '#513848',
    }),
  },
  {
    id: 'purple',
    name: 'Tím',
    preview: '#b9a0ff',
    tokens: palette({
      bg: '#0e0c13',
      panel: '#1b1725',
      elevated: '#292336',
      text: '#f8f5ff',
      muted: '#c5bed3',
      accent: '#b9a0ff',
      hover: '#d2bfff',
      ink: '#1b1036',
      line: '#463c59',
    }),
  },
  {
    id: 'blue',
    name: 'Xanh dương',
    preview: '#85b7ff',
    tokens: palette({
      bg: '#0b0e14',
      panel: '#141c29',
      elevated: '#202c3e',
      text: '#f3f7ff',
      muted: '#b9c6db',
      accent: '#85b7ff',
      hover: '#b0d2ff',
      ink: '#0c1b34',
      line: '#344864',
    }),
  },
  {
    id: 'teal',
    name: 'Xanh ngọc',
    preview: '#61d9d1',
    tokens: palette({
      bg: '#090f10',
      panel: '#132024',
      elevated: '#1d3034',
      text: '#f0fcfb',
      muted: '#b7cdcd',
      accent: '#61d9d1',
      hover: '#96eee6',
      ink: '#082522',
      line: '#325255',
    }),
  },
  {
    id: 'amber',
    name: 'Vàng mật ong',
    preview: '#e8c768',
    tokens: palette({
      bg: '#110f09',
      panel: '#211e13',
      elevated: '#302b1d',
      text: '#fffbed',
      muted: '#cdc7ad',
      accent: '#e8c768',
      hover: '#ffe09a',
      ink: '#251e08',
      line: '#51492e',
    }),
  },
  {
    id: 'slate',
    name: 'Xám',
    preview: '#b3c4d8',
    tokens: palette({
      bg: '#0d1013',
      panel: '#181e24',
      elevated: '#252e37',
      text: '#f4f8fc',
      muted: '#bdc6d0',
      accent: '#b3c4d8',
      hover: '#d6e3ef',
      ink: '#14202f',
      line: '#414e5e',
    }),
  },
] as const;

export type ThemeId = (typeof themes)[number]['id'];
export const themeCookie = 'infosound-theme';
export function resolveTheme(value: unknown): ThemeId {
  return typeof value === 'string' && themes.some((theme) => theme.id === value)
    ? (value as ThemeId)
    : 'forest';
}
export function getTheme(id: ThemeId) {
  return themes.find((theme) => theme.id === id) || themes[0];
}
