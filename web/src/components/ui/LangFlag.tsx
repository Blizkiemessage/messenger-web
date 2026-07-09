/**
 * LangFlag — inline SVG flag icons for the language switcher.
 *
 * Regional-indicator flag emoji (🇷🇺/🇬🇧) don't render as flags on Windows —
 * most Windows fonts lack colored flag glyphs, so they fall back to plain
 * two-letter codes ("RU"/"GB"). Real SVG art renders identically everywhere.
 */
interface Props {
  locale: 'ru' | 'en';
  className?: string;
}

export function LangFlag({ locale, className }: Props) {
  if (locale === 'ru') {
    return (
      <svg className={className} viewBox="0 0 3 2" aria-hidden="true" focusable="false">
        <rect width="3" height="2" fill="#fff" />
        <rect y="0.667" width="3" height="0.667" fill="#0039A6" />
        <rect y="1.333" width="3" height="0.667" fill="#D52B1E" />
      </svg>
    );
  }

  const stripeH = 100 / 13;
  return (
    <svg className={className} viewBox="0 0 190 100" aria-hidden="true" focusable="false">
      <rect width="190" height="100" fill="#B22234" />
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={i} y={(2 * i + 1) * stripeH} width="190" height={stripeH} fill="#fff" />
      ))}
      <rect width="76" height={7 * stripeH} fill="#3C3B6E" />
      {Array.from({ length: 20 }).map((_, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = 8 + col * 14 + (row % 2 ? 7 : 0);
        const y = 8 + row * 12;
        return <circle key={i} cx={x} cy={y} r="2" fill="#fff" />;
      })}
    </svg>
  );
}
