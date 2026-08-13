import { Select } from '../Select';

// Cathode's only dropdown type. Every native <select> in the app is routed through
// it by enhanceSelect(), so this is what a dropdown looks like everywhere — the
// framework and project pickers, the eyedropper, MCP, tabs, the animation panel and
// the Box Select property rows are all this component on different surfaces.
const options = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export default {
  title: 'Cathode Design System / Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: 'The canonical dropdown (`.ct-select`). Shade-4 button with the signature blob corner and Zalando uppercase label; shade-7 menu with a shade-6 hairline and mono options. The selected row takes the accent.' } },
  },
};

export const Default = { args: { options, placeholder: 'Select a model…' } };
export const WithValue = { args: { options, defaultValue: 'sonnet' } };
export const Disabled = { args: { options, defaultValue: 'opus', disabled: true } };

// Same control, inline in the Box Select property rows — slightly shorter.
const flexOptions = [
  { value: 'flex', label: 'Flex' },
  { value: 'block', label: 'Block' },
  { value: 'grid', label: 'Grid' },
  { value: 'inline-flex', label: 'Inline-flex' },
];
export const Small = { args: { options: flexOptions, size: 'sm', defaultValue: 'block' } };

// A long list scrolls inside the menu rather than running off the surface.
export const LongList = {
  args: {
    placeholder: 'Choose framework',
    options: ['Auto-detect', 'HTML / static site', 'React', 'Vue', 'Angular', 'Svelte', 'SolidJS', 'Preact', 'Web Components', 'Next.js', 'Nuxt', 'SvelteKit']
      .map((v) => ({ value: v.toLowerCase(), label: v })),
  },
};
