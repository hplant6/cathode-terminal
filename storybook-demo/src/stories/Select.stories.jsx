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

// Smaller dropdown type — shade-4 fill, no border, 18px blob corner, Zalando 10px
// uppercase. Used inline by the box-select tool's property fields.
const flexOptions = [
  { value: 'flex', label: 'Flex' },
  { value: 'block', label: 'Block' },
  { value: 'grid', label: 'Grid' },
  { value: 'inline-flex', label: 'Inline-flex' },
];
export const Small = { args: { options: flexOptions, size: 'sm', defaultValue: 'flex' } };
