import React from 'react';
import { Chip } from '../Chip';

export default {
  title: 'Cathode Design System / Chip',
  component: Chip,
  argTypes: {
    label: { control: 'text' },
    variant: { control: 'select', options: ['accent', 'neutral'] },
    removable: { control: 'boolean' },
  },
  tags: ['autodocs'],
};

export const Accent = { args: { label: 'Build Selected Frame', variant: 'accent' } };
export const Neutral = { args: { label: 'color', variant: 'neutral' } };
export const Removable = { args: { label: 'Extract Variables', variant: 'accent', removable: true } };

export const ChipGroup = {
  name: 'Chip Group',
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip label="Color Contrast" removable />
      <Chip label="Typography" removable />
      <Chip label="Spacing" variant="neutral" />
    </div>
  ),
};
