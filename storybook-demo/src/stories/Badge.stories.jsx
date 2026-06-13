import React from 'react';
import { Badge } from '../Badge';

export default {
  title: 'Cathode Design System / Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['default', 'accent', 'success', 'danger', 'warning'] },
    dot:     { control: 'boolean' },
    label:   { control: 'text' },
  },
  tags: ['autodocs'],
};

export const Default = { args: { label: 'Default',   variant: 'default' } };
export const Accent  = { args: { label: 'Active',    variant: 'accent',  dot: true } };
export const Success = { args: { label: 'Connected', variant: 'success', dot: true } };
export const Danger  = { args: { label: 'Error',     variant: 'danger',  dot: true } };
export const Warning = { args: { label: 'Warning',   variant: 'warning' } };

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge label="Default"   variant="default" />
      <Badge label="Active"    variant="accent"  dot />
      <Badge label="Connected" variant="success" dot />
      <Badge label="Error"     variant="danger"  dot />
      <Badge label="Warning"   variant="warning" />
    </div>
  ),
  name: 'All Variants',
};
