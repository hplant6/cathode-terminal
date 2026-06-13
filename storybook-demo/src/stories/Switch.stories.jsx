import { Switch } from '../Switch';

export default {
  title: 'Cathode Design System / Switch',
  component: Switch,
  argTypes: {
    label: { control: 'text' },
    defaultChecked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  tags: ['autodocs'],
};

export const Off = { args: { label: 'Auto-reference design tokens', defaultChecked: false } };
export const On = { args: { label: 'Auto-reference design tokens', defaultChecked: true } };
export const Disabled = { args: { label: 'Unavailable', defaultChecked: true, disabled: true } };
