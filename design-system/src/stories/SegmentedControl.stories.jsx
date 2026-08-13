import { SegmentedControl } from '../SegmentedControl';

export default {
  title: 'Cathode Design System / SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs'],
};

export const TwoOptions = {
  args: { options: [{ value: 'chat', label: 'Chat' }, { value: 'terminal', label: 'Terminal' }], defaultValue: 'chat' },
};
export const ThreeOptions = {
  args: {
    options: [{ value: 'a', label: 'Detailed' }, { value: 'b', label: 'Compact' }, { value: 'c', label: 'Off' }],
    defaultValue: 'a',
  },
};

// Full-width, button-height variant — the Extract tool's media destination toggle.
export const FullWidthDestination = {
  name: 'Full Width (Destination)',
  render: (args) => (
    <div style={{ width: 320 }}>
      <SegmentedControl {...args} />
    </div>
  ),
  args: {
    fullWidth: true,
    options: [{ value: 'chat', label: 'Send to chat' }, { value: 'download', label: 'Download…' }],
    defaultValue: 'chat',
  },
};
