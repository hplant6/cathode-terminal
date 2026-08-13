import { PanelFooter } from '../PanelFooter';

export default {
  title: 'Cathode Design System / Panel Footer',
  component: PanelFooter,
  tags: ['autodocs'],
  decorators: [(Story) => (
    <div style={{ width: 460, background: 'var(--spec-toolbar-bg)', borderRadius: 22, overflow: 'hidden' }}>
      <Story />
    </div>
  )],
};

export const Default = { args: {} };
export const InsertVariant = { args: { sendLabel: 'Insert' } };
