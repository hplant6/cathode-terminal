import { Drawer } from '../Drawer';

export default {
  title: 'Cathode Design System / Context Drawer',
  component: Drawer,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: 'Collapsible drawer that tucks tool-injected context (CSS / logs / code / page URL) out of the chat. Closed: shade-3 border, no fill. Open: shade-7 fill fades in, border fades out, 22px radius. Zalando uppercase label, orange chevron on hover.' } },
  },
  argTypes: {
    label: { control: 'text' },
    defaultOpen: { control: 'boolean' },
  },
  decorators: [(Story) => (
    <div style={{ padding: 20, background: 'var(--spec-structural)', borderRadius: 8, width: 440, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: 360 }}><Story /></div>
    </div>
  )],
};

const ELEMENT_SAMPLE = `───── Element Context ─────
These are live elements from the page I have open in the app's Working File — http://localhost:3000

• .hero-title
    font-size: 32px;
    font-weight: 700;
    color: #08090C;`;

export const Closed = { args: { label: 'Element Context', children: ELEMENT_SAMPLE, defaultOpen: false } };
export const Open   = { args: { label: 'Element Context', children: ELEMENT_SAMPLE, defaultOpen: true } };

export const ConsoleErrors = {
  args: {
    label: 'Console errors · 3',
    defaultOpen: true,
    children: `───── Console errors (3) ─────
• [console] Uncaught TypeError: Cannot read properties of null  (app.js:142)
• [request] GET /api/env-config.io — HTTP 404
• [console] Warning: each child in a list should have a unique "key"  (list.jsx:19)`,
  },
};
