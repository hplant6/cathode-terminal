import { Selection } from '../Selection';

export default {
  title: 'Cathode Design System / Selection',
  component: Selection,
  tags: ['autodocs'],
  // Dark backdrop + padding so the label (above the box) and the glow aren't clipped.
  decorators: [(Story) => (
    <div style={{ background: '#19191C', padding: '48px 32px', display: 'inline-block' }}>
      <Story />
    </div>
  )],
};

export const Default = { args: { label: 'Container: K' } };
export const WithoutLabel = { args: { label: '' } };
export const Large = { args: { width: 360, height: 200, label: 'Text Input: input#email' } };
