import { TextToggle } from '../TextToggle';

export default {
  title: 'Cathode Design System / TextToggle',
  component: TextToggle,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Small text toggle tabs — a sliding switch. A shade-7 thumb animates ' +
          'between options; the inactive label sits at shade 3 and brightens to ' +
          'shade 1 on hover. Labels use Zalando SemiExpanded, uppercase. ' +
          'Used for the Usage panel’s Bar / Dial switch.',
      },
    },
  },
};

// The Usage panel switch.
export const BarDial = {
  name: 'Bar / Dial',
  args: {
    options: [
      { value: 'bar', label: 'Bar' },
      { value: 'dial', label: 'Dial' },
    ],
    defaultValue: 'bar',
  },
};

// Scales to 3+ options — the thumb slides to whichever is selected.
export const ThreeOptions = {
  args: {
    options: [
      { value: 'a', label: 'One' },
      { value: 'b', label: 'Two' },
      { value: 'c', label: 'Three' },
    ],
    defaultValue: 'a',
  },
};
