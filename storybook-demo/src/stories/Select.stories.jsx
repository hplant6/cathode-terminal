import { Select } from '../Select';

const options = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export default {
  title: 'Cathode Design System / Select',
  component: Select,
  tags: ['autodocs'],
};

export const Default = { args: { options, placeholder: 'Select a model…' } };
export const WithValue = { args: { options, defaultValue: 'sonnet' } };
export const Disabled = { args: { options, defaultValue: 'opus', disabled: true } };
