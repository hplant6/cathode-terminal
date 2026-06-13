import React from 'react';
import { ProgressBar } from '../ProgressBar';

export default {
  title: 'Cathode Design System / ProgressBar',
  component: ProgressBar,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    label: { control: 'text' },
    showValue: { control: 'boolean' },
  },
  tags: ['autodocs'],
};

export const Default = { args: { value: 45, label: 'Context window' } };
export const Warning = { args: { value: 78, label: 'Current session (5h)' } };
export const Critical = { args: { value: 94, label: 'Current week' } };

export const Thresholds = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ProgressBar value={30} label="Healthy" />
      <ProgressBar value={78} label="Warning" />
      <ProgressBar value={95} label="Critical" />
    </div>
  ),
};
