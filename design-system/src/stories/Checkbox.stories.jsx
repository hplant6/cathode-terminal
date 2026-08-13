import { Checkbox } from '../Checkbox';

export default {
  title: 'Cathode Design System / Checkbox',
  component: Checkbox,
  argTypes: {
    label: { control: 'text' },
    defaultChecked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  tags: ['autodocs'],
};

export const Unchecked = { args: { label: 'Color Contrast (WCAG AA)', defaultChecked: false } };
export const Checked = { args: { label: 'Color Contrast (WCAG AA)', defaultChecked: true } };
export const Disabled = { args: { label: 'Not available', defaultChecked: false, disabled: true } };
