export function faviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

const PLATFORM_RULES = [
  { key: 'youtube', pattern: /youtube\.com|youtu\.be/i },
  { key: 'github', pattern: /github\.com|githubusercontent\.com/i },
  { key: 'reddit', pattern: /reddit\.com/i },
  { key: 'instagram', pattern: /instagram\.com/i },
  { key: 'x', pattern: /x\.com|twitter\.com/i },
  { key: 'facebook', pattern: /facebook\.com|fb\.com/i },
  { key: 'tiktok', pattern: /tiktok\.com/i },
  { key: 'linkedin', pattern: /linkedin\.com/i },
  { key: 'discord', pattern: /discord\.(?:com|gg)/i },
  { key: 'wikipedia', pattern: /wikipedia\.org/i },
  { key: 'medium', pattern: /medium\.com/i },
  { key: 'bilibili', pattern: /bilibili\.com|b23\.tv/i },
  { key: 'weibo', pattern: /weibo\.(?:com|cn)/i },
  { key: 'twitch', pattern: /twitch\.tv/i },
  { key: 'spotify', pattern: /spotify\.com|open\.spotify\.com/i },
  { key: 'stackoverflow', pattern: /stackoverflow\.com/i },
  { key: 'npm', pattern: /npmjs\.com/i },
  { key: 'hackernews', pattern: /news\.ycombinator\.com|ycombinator\.com/i },
  { key: 'producthunt', pattern: /producthunt\.com/i },
  { key: 'vercel', pattern: /vercel\.com/i },
  { key: 'openai', pattern: /openai\.com|chatgpt\.com/i },
  { key: 'anthropic', pattern: /anthropic\.com|claude\.ai/i },
  { key: 'arxiv', pattern: /arxiv\.org/i },
  { key: 'notion', pattern: /notion\.(?:so|site)/i },
  { key: 'figma', pattern: /figma\.com/i },
];

export function inferEmbedType(url, type) {
  if (type && type !== 'link') return type;
  const value = String(url || '').toLowerCase();
  for (const rule of PLATFORM_RULES) {
    if (rule.pattern.test(value)) return rule.key;
  }
  return 'link';
}

const SHORT_LINK_HOST_RE =
  /^(t\.co|bit\.ly|goo\.gl|tinyurl\.com|ow\.ly|buff\.ly|is\.gd|j\.mp|aka\.ms|lnkd\.in|dl\.tiktok\.com)$/i;

export function isShortLinkUrl(url) {
  try {
    const host = new URL(String(url || '').trim()).hostname.replace(/^www\./, '').toLowerCase();
    return SHORT_LINK_HOST_RE.test(host);
  } catch {
    return false;
  }
}

export const EMBED_BRANDS = {
  github: {
    label: 'GitHub',
    accent: '#24292f',
    headerBg: 'color-mix(in srgb, #24292f 22%, var(--bg-secondary))',
    headerText: '#e6edf3',
    iconBg: '#24292f',
    iconColor: '#ffffff',
    badgeBg: 'var(--bg-tertiary)',
    badgeText: 'var(--text-secondary)',
  },
  youtube: {
    label: 'YouTube',
    accent: '#ff0033',
    headerBg: 'color-mix(in srgb, #ff0033 9%, var(--bg-secondary))',
    headerText: '#ff4d6d',
    iconBg: '#ff0033',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ff0033 14%, transparent)',
    badgeText: '#ff4d6d',
  },
  reddit: {
    label: 'Reddit',
    accent: '#ff4500',
    headerBg: 'color-mix(in srgb, #ff4500 9%, var(--bg-secondary))',
    headerText: '#ff6b35',
    iconBg: '#ff4500',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ff4500 14%, transparent)',
    badgeText: '#ff6b35',
  },
  instagram: {
    label: 'Instagram',
    accent: '#E1306C',
    headerBg: 'linear-gradient(135deg, color-mix(in srgb, #833AB4 16%, var(--bg-secondary)), color-mix(in srgb, #FD1D1D 10%, var(--bg-secondary)), color-mix(in srgb, #F77737 8%, var(--bg-secondary)))',
    headerText: '#E1306C',
    iconBg: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #E1306C 14%, transparent)',
    badgeText: '#E1306C',
  },
  x: {
    label: 'X',
    accent: '#ffffff',
    headerBg: 'color-mix(in srgb, #ffffff 6%, var(--bg-secondary))',
    headerText: '#e7e9ea',
    iconBg: '#000000',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ffffff 10%, transparent)',
    badgeText: '#d1d5db',
  },
  facebook: {
    label: 'Facebook',
    accent: '#1877F2',
    headerBg: 'color-mix(in srgb, #1877F2 9%, var(--bg-secondary))',
    headerText: '#60a5fa',
    iconBg: '#1877F2',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #1877F2 14%, transparent)',
    badgeText: '#60a5fa',
  },
  tiktok: {
    label: 'TikTok',
    accent: '#ff0050',
    headerBg: 'color-mix(in srgb, #ff0050 8%, var(--bg-secondary))',
    headerText: '#ff4d88',
    iconBg: '#000000',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ff0050 14%, transparent)',
    badgeText: '#ff4d88',
  },
  linkedin: {
    label: 'LinkedIn',
    accent: '#0A66C2',
    headerBg: 'color-mix(in srgb, #0A66C2 9%, var(--bg-secondary))',
    headerText: '#60a5fa',
    iconBg: '#0A66C2',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #0A66C2 14%, transparent)',
    badgeText: '#60a5fa',
  },
  discord: {
    label: 'Discord',
    accent: '#5865F2',
    headerBg: 'color-mix(in srgb, #5865F2 9%, var(--bg-secondary))',
    headerText: '#818cf8',
    iconBg: '#5865F2',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #5865F2 14%, transparent)',
    badgeText: '#818cf8',
  },
  wikipedia: {
    label: 'Wikipedia',
    accent: '#3366cc',
    headerBg: 'color-mix(in srgb, #3366cc 9%, var(--bg-secondary))',
    headerText: '#93c5fd',
    iconBg: '#3366cc',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #3366cc 14%, transparent)',
    badgeText: '#93c5fd',
  },
  medium: {
    label: 'Medium',
    accent: '#ffffff',
    headerBg: 'color-mix(in srgb, #ffffff 5%, var(--bg-secondary))',
    headerText: '#e5e7eb',
    iconBg: '#121212',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ffffff 8%, transparent)',
    badgeText: '#d1d5db',
  },
  bilibili: {
    label: 'Bilibili',
    accent: '#FB7299',
    headerBg: 'color-mix(in srgb, #FB7299 9%, var(--bg-secondary))',
    headerText: '#fb9eb8',
    iconBg: '#FB7299',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #FB7299 14%, transparent)',
    badgeText: '#fb9eb8',
  },
  weibo: {
    label: 'Weibo',
    accent: '#E6162D',
    headerBg: 'color-mix(in srgb, #E6162D 9%, var(--bg-secondary))',
    headerText: '#f87171',
    iconBg: '#E6162D',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #E6162D 14%, transparent)',
    badgeText: '#f87171',
  },
  twitch: {
    label: 'Twitch',
    accent: '#9146FF',
    headerBg: 'color-mix(in srgb, #9146FF 9%, var(--bg-secondary))',
    headerText: '#a78bfa',
    iconBg: '#9146FF',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #9146FF 14%, transparent)',
    badgeText: '#a78bfa',
  },
  spotify: {
    label: 'Spotify',
    accent: '#1DB954',
    headerBg: 'color-mix(in srgb, #1DB954 9%, var(--bg-secondary))',
    headerText: '#4ade80',
    iconBg: '#1DB954',
    iconColor: '#000000',
    badgeBg: 'color-mix(in srgb, #1DB954 14%, transparent)',
    badgeText: '#4ade80',
  },
  stackoverflow: {
    label: 'Stack Overflow',
    accent: '#F48024',
    headerBg: 'color-mix(in srgb, #F48024 9%, var(--bg-secondary))',
    headerText: '#fb923c',
    iconBg: '#F48024',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #F48024 14%, transparent)',
    badgeText: '#fb923c',
  },
  npm: {
    label: 'npm',
    accent: '#CB3837',
    headerBg: 'color-mix(in srgb, #CB3837 9%, var(--bg-secondary))',
    headerText: '#f87171',
    iconBg: '#CB3837',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #CB3837 14%, transparent)',
    badgeText: '#f87171',
  },
  hackernews: {
    label: 'Hacker News',
    accent: '#FF6600',
    headerBg: 'color-mix(in srgb, #FF6600 12%, var(--bg-secondary))',
    headerText: '#FF8533',
    iconBg: '#FF6600',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #FF6600 14%, transparent)',
    badgeText: '#FF8533',
  },
  producthunt: {
    label: 'Product Hunt',
    accent: '#DA552F',
    headerBg: 'color-mix(in srgb, #DA552F 10%, var(--bg-secondary))',
    headerText: '#F97316',
    iconBg: '#DA552F',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #DA552F 14%, transparent)',
    badgeText: '#F97316',
  },
  vercel: {
    label: 'Vercel',
    accent: '#ffffff',
    headerBg: 'color-mix(in srgb, #ffffff 6%, var(--bg-secondary))',
    headerText: '#e5e7eb',
    iconBg: '#000000',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ffffff 10%, transparent)',
    badgeText: '#d1d5db',
  },
  openai: {
    label: 'OpenAI',
    accent: '#10A37F',
    headerBg: 'color-mix(in srgb, #10A37F 10%, var(--bg-secondary))',
    headerText: '#34D399',
    iconBg: '#10A37F',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #10A37F 14%, transparent)',
    badgeText: '#34D399',
  },
  anthropic: {
    label: 'Anthropic',
    accent: '#D4A27F',
    headerBg: 'color-mix(in srgb, #D4A27F 12%, var(--bg-secondary))',
    headerText: '#E8C4A8',
    iconBg: '#191919',
    iconColor: '#D4A27F',
    badgeBg: 'color-mix(in srgb, #D4A27F 14%, transparent)',
    badgeText: '#E8C4A8',
  },
  arxiv: {
    label: 'arXiv',
    accent: '#B31B1B',
    headerBg: 'color-mix(in srgb, #B31B1B 10%, var(--bg-secondary))',
    headerText: '#F87171',
    iconBg: '#B31B1B',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #B31B1B 14%, transparent)',
    badgeText: '#F87171',
  },
  notion: {
    label: 'Notion',
    accent: '#ffffff',
    headerBg: 'color-mix(in srgb, #ffffff 5%, var(--bg-secondary))',
    headerText: '#e5e7eb',
    iconBg: '#000000',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #ffffff 8%, transparent)',
    badgeText: '#d1d5db',
  },
  figma: {
    label: 'Figma',
    accent: '#F24E1E',
    headerBg: 'linear-gradient(135deg, color-mix(in srgb, #F24E1E 12%, var(--bg-secondary)), color-mix(in srgb, #A259FF 10%, var(--bg-secondary)), color-mix(in srgb, #0ACF83 8%, var(--bg-secondary)))',
    headerText: '#F24E1E',
    iconBg: 'linear-gradient(135deg, #F24E1E, #A259FF, #1ABCFE, #0ACF83)',
    iconColor: '#ffffff',
    badgeBg: 'color-mix(in srgb, #F24E1E 14%, transparent)',
    badgeText: '#F24E1E',
  },
  link: {
    label: 'Link',
    accent: 'var(--accent-blue)',
    headerBg: 'var(--bg-tertiary)',
    headerText: 'var(--text-muted)',
    iconBg: 'var(--bg-secondary)',
    iconColor: 'var(--text-secondary)',
    badgeBg: 'var(--bg-tertiary)',
    badgeText: 'var(--text-muted)',
  },
};

export function getEmbedBrand(type, url) {
  const key = inferEmbedType(url, type);
  return { key, ...EMBED_BRANDS[key] || EMBED_BRANDS.link };
}

export function isKnownPlatform(type, url) {
  return inferEmbedType(url, type) !== 'link';
}

const HERO_IMAGE_TYPES = new Set([
  'youtube',
  'reddit',
  'instagram',
  'x',
  'facebook',
  'tiktok',
  'linkedin',
  'wikipedia',
  'medium',
  'bilibili',
  'weibo',
  'twitch',
  'link',
  'image',
]);

export function shouldShowHeroImage(type, url, image) {
  if (!image) return false;
  const resolved = inferEmbedType(url, type);
  if (resolved === 'github') return false;
  return HERO_IMAGE_TYPES.has(resolved);
}

export function BrandLogo({ brandKey, size = 16, className }) {
  const s = size;

  if (brandKey === 'github') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    );
  }
  if (brandKey === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
      </svg>
    );
  }
  if (brandKey === 'reddit') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
      </svg>
    );
  }
  if (brandKey === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.85-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    );
  }
  if (brandKey === 'x') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (brandKey === 'facebook') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }
  if (brandKey === 'tiktok') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.919-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    );
  }
  if (brandKey === 'linkedin') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.062 2.062 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    );
  }
  if (brandKey === 'discord') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.2252 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
      </svg>
    );
  }
  if (brandKey === 'wikipedia') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12.09 13.119c-.936 1.932-2.214 4.548-2.909 5.665l-2.804-5.231H4.831l4.579 8.18c.456.815.874 1.078 1.578 1.078.704 0 1.122-.263 1.578-1.078l4.579-8.18h-1.546l-2.411 4.566zM12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm.015 2.844a9.156 9.156 0 1 1 0 18.312 9.156 9.156 0 0 1 0-18.312z" />
      </svg>
    );
  }
  if (brandKey === 'medium') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zM20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z" />
      </svg>
    );
  }
  if (brandKey === 'bilibili') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906 1.239 1.239 0 0 1 1.233-1.234H7.44a1.239 1.239 0 0 1 1.234 1.234c0 .336-.134.654-.373.906l-1.174 1.12h7.305l-1.174-1.12a1.234 1.234 0 0 1-.373-.906 1.239 1.239 0 0 1 1.233-1.234h2.826a1.239 1.239 0 0 1 1.234 1.234c0 .336-.134.654-.373.906l-1.174 1.12zM5.333 7.653c-.676.018-1.234.574-1.253 1.253v7.36c.019.676.577 1.234 1.253 1.253h12.694c.676-.019 1.234-.577 1.253-1.253v-7.36c-.019-.679-.577-1.235-1.253-1.253H5.333zM8 11.347a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm8 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" />
      </svg>
    );
  }
  if (brandKey === 'weibo') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.966-.394 7.415 1.404 7.671 4.018.259 2.6-2.759 5.049-6.739 5.443zm.01-3.647c1.895-.187 3.297-1.383 3.116-2.669-.18-1.287-1.901-2.106-3.795-1.919-1.894.187-3.297 1.383-3.116 2.669.18 1.287 1.901 2.106 3.795 1.919zm8.831-10.747c-.608-.063-1.062-.58-.997-1.154.065-.574.624-.995 1.232-.932.608.063 1.062.58.997 1.154-.065.574-.624.995-1.232.932zm-1.832 1.855c-2.164 2.215-5.246 3.155-8.135 2.869-2.889-.286-5.195-1.705-6.432-3.92-1.237-2.215-.987-4.812.703-6.727C4.882 1.712 7.964.772 10.853 1.058c2.889.286 5.195 1.705 6.432 3.92 1.237 2.215.987 4.812-.703 6.727z" />
      </svg>
    );
  }
  if (brandKey === 'twitch') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </svg>
    );
  }
  if (brandKey === 'spotify') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    );
  }
  if (brandKey === 'stackoverflow') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M18.986 21.865v-6.404h2.134V24H1.844v-8.539h2.13v6.404h15.012zM6.111 12.908l9.885-2.045 1.45 7.032-9.885 2.045-1.45-7.032zm1.388-5.137L17.329 4.66l1.598 6.964-9.83 2.111-1.598-6.964zM15.019 0l2.582 6.952L6.624 9.368 4.042 2.416 15.019 0z" />
      </svg>
    );
  }
  if (brandKey === 'npm') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-1.256 12.256H6.376zm1.951 1.954v7.617h1.969v-2.018h2.018v2.018h1.969V7.277z" />
      </svg>
    );
  }
  if (brandKey === 'hackernews') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M6.951 5.896l4.112 7.708v5.064h1.583v-4.972l4.148-7.799h-1.749l-2.457 4.958h-.057L8.73 5.896H6.951z" />
      </svg>
    );
  }
  if (brandKey === 'producthunt') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M13.604 8.4h-3.405V12h3.405a1.8 1.8 0 0 0 0-3.6zM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm1.604 14.4h-3.405V18H7.801V6h5.803a4.2 4.2 0 0 1 0 8.4z" />
      </svg>
    );
  }
  if (brandKey === 'vercel') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 1.5 24 22.5H0L12 1.5z" />
      </svg>
    );
  }
  if (brandKey === 'openai') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.3a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.76a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.762a.771.771 0 0 0 .78 0l5.843-3.373v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.844-3.375L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.592a.79.79 0 0 0-.407-.68zm2.01-3.023-.141-.085-4.784-2.747a.766.766 0 0 0-.78 0L9.409 9.27V6.938a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.146.087L8.962 5.47a.782.782 0 0 0-.393.681zm1.097-2.365 2.602-1.503 2.607 1.503v3.006l-2.597 1.498-2.607-1.498z" />
      </svg>
    );
  }
  if (brandKey === 'anthropic') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M13.827 3.52h3.603L22 20.48h-3.603l-1.247-4.013h-6.185L9.717 20.48H6.115L13.827 3.52zm.905 3.549-2.238 7.195h4.476l-2.238-7.195zM5.082 3.52h3.604l.8 2.82H5.882L5.082 3.52zM2 20.48l1.247-4.013h3.604L5.604 20.48H2z" />
      </svg>
    );
  }
  if (brandKey === 'arxiv') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M3.6 2.4 12 10.8 20.4 2.4H24L13.8 12.6 24 21.6h-3.6L12 13.2 3.6 21.6H0l10.2-9L0 2.4h3.6z" />
      </svg>
    );
  }
  if (brandKey === 'notion') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.86 2.83c-.42-.326-.981-.7-2.055-.607L3.01 3.445c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.746-.887l-15.177.887c-.56.047-.749.327-.749.933zm14.337.745c.093.42 0 .793-.42.84l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.45.327s0 .793-1.121.793l-3.077.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.62c-.094-.42.14-1.026.793-1.073l3.456-.233 4.763 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.079.7l4.249 2.986c.7.513.934.747.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.45-1.632z" />
      </svg>
    );
  }
  if (brandKey === 'figma') {
    return (
      <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
        <path fill="currentColor" d="M15.852 8.981h-4.588V0h4.588a4.49 4.49 0 0 1 3.176 1.316A4.49 4.49 0 0 1 20.34 4.49a4.49 4.49 0 0 1-1.316 3.175 4.49 4.49 0 0 1-3.172 1.316zM5.588 24a4.49 4.49 0 0 1-3.176-1.316A4.49 4.49 0 0 1 1.096 19.51a4.49 4.49 0 0 1 1.316-3.176A4.49 4.49 0 0 1 5.588 15.02h4.588v4.49A4.49 4.49 0 0 1 5.588 24zm5.588-8.981H5.588a4.49 4.49 0 0 1-3.176-1.315A4.49 4.49 0 0 1 1.096 10.49a4.49 4.49 0 0 1 1.316-3.176A4.49 4.49 0 0 1 5.588 6h5.588v9.019zm0-9.019H5.588a4.49 4.49 0 0 1-3.176-1.315A4.49 4.49 0 0 1 1.096 1.316 4.49 4.49 0 0 1 5.588 0h5.588v6zM23 10.49a4.49 4.49 0 0 1-1.316 3.176 4.49 4.49 0 0 1-3.175 1.315 4.49 4.49 0 0 1-3.176-1.315A4.49 4.49 0 0 1 14.018 10.49a4.49 4.49 0 0 1 1.315-3.176A4.49 4.49 0 0 1 18.51 6a4.49 4.49 0 0 1 3.175 1.314A4.49 4.49 0 0 1 23 10.49z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width={s} height={s} className={className} aria-hidden="true">
      <path fill="currentColor" d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.43l.47-.48a2.982 2.982 0 0 0 0-4.24 2.982 2.982 0 0 0-4.24 0l-3.53 3.53a2.982 2.982 0 0 0 0 4.24zm2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.43l-.47.48a2.982 2.982 0 0 0 0 4.24 2.982 2.982 0 0 0 4.24 0l3.53-3.53a2.982 2.982 0 0 0 0-4.24z" />
    </svg>
  );
}
