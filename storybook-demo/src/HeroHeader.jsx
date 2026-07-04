import React, { useEffect, useState } from 'react';
import './HeroHeader.css';

/* Skills that cycle through the title's rotating slot (from itshenry.me). */
const DEFAULT_WORDS = [
  'AI constructs', 'figma variables', 'Creative Direction', 'Prototyping',
  'Components', 'User Journeys', 'Working agile', 'HTML/CSS',
  'User testing', 'Prompt Engineering',
];

const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' };

/* Hero header — eyebrow sub-heading over a title whose last line is a
   zoom-animated rotating word. Recreation of the itshenry.me landing hero,
   rebuilt on Cathode design tokens. */
export function HeroHeader({
  subHeading = 'Henry Plant, Senior Product Designer',
  headingPrefix = 'Mastering',
  words = DEFAULT_WORDS,
  interval = 2200,
  align = 'center',
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!words || words.length < 2) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => setIndex(i => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words, interval]);

  const word = words && words.length ? words[index % words.length] : '';

  return (
    <header
      className="hero"
      style={{ textAlign: align, alignItems: ALIGN_ITEMS[align] || 'center' }}
    >
      {subHeading && (
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-box">{subHeading}</span>
        </div>
      )}
      <h1 className="hero-title">
        {headingPrefix && <span className="hero-title-prefix">{headingPrefix}</span>}
        <span className="hero-rotator" aria-live="polite">
          {/* keyed by index so each swap replays the zoom-in keyframe */}
          <span key={index} className="hero-word">{word}</span>
        </span>
      </h1>
    </header>
  );
}
