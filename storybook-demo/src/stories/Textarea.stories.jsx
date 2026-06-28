import { Textarea } from '../Textarea';

export default {
  title: 'Cathode Design System / Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: 'Multiline input — dark / address-bar style (shade-7 fill, shade-3 border, shade-1 focus). Vertically resizable via a custom corner glyph. Defaults to 4 rows.' } },
  },
  decorators: [(Story) => (
    <div style={{ width: 460, padding: 16, background: 'var(--spec-structural)', borderRadius: 8 }}>
      <Story />
    </div>
  )],
};

export const Default = { args: { label: 'Prompt', placeholder: 'Audit prompt sent to Claude Code...' } };   // 4 rows
export const Filled  = { args: { label: 'Prompt', defaultValue: 'Run a correctness audit on this codebase. Report findings only — do not make changes.' } };
export const SixRows = { args: { label: 'Notes', rows: 6, placeholder: 'Longer multiline input...' } };
