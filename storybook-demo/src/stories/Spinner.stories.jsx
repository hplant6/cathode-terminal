import React from 'react';
import { Spinner } from '../Spinner';

export default {
  title: 'Cathode Design System / Spinner',
  component: Spinner,
  argTypes: {
    size: { control: { type: 'range', min: 10, max: 48 } },
    label: { control: 'text' },
  },
  tags: ['autodocs'],
};

export const Default = { args: { size: 16 } };
export const WithLabel = { args: { size: 14, label: 'Switching to Opus…' } };

export const Sizes = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Spinner size={12} />
      <Spinner size={18} />
      <Spinner size={28} />
    </div>
  ),
};
