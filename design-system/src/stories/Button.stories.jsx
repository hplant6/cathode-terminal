import React from 'react';
import { Button } from '../Button';

export default {
  title: 'Cathode Design System / Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size:    { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled:{ control: 'boolean' },
    label:   { control: 'text' },
  },
  tags: ['autodocs'],
};

export const Primary = { args: { label: 'Save Changes', variant: 'primary', size: 'md' } };
export const Secondary = { args: { label: 'Cancel', variant: 'secondary', size: 'md' } };
export const Ghost = { args: { label: 'Browse', variant: 'ghost', size: 'md' } };
export const Danger = { args: { label: 'Disconnect', variant: 'danger', size: 'md' } };
export const Disabled = { args: { label: 'Unavailable', variant: 'primary', size: 'md', disabled: true } };

export const SizeComparison = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Button label="Small"  variant="secondary" size="sm" />
      <Button label="Medium" variant="secondary" size="md" />
      <Button label="Large"  variant="secondary" size="lg" />
    </div>
  ),
  name: 'All Sizes',
};

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <Button label="Primary"   variant="primary"   size="md" />
      <Button label="Secondary" variant="secondary" size="md" />
      <Button label="Ghost"     variant="ghost"     size="md" />
      <Button label="Danger"    variant="danger"    size="md" />
    </div>
  ),
  name: 'All Variants',
};
