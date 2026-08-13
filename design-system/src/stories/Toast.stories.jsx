import React from 'react';
import { Toast } from '../Toast';

export default {
  title: 'Cathode Design System / Toast',
  component: Toast,
  argTypes: { spinner: { control: 'boolean' } },
  tags: ['autodocs'],
};

export const Switching = { args: { children: 'Switching to Opus…', spinner: true } };
export const Confirmation = { args: { children: 'Model: Opus', spinner: false } };

export const Stack = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <Toast spinner>Switching to Opus…</Toast>
      <Toast>Model: Sonnet</Toast>
    </div>
  ),
};
