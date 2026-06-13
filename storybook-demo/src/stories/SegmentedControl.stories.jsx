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
