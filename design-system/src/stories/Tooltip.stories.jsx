import React from 'react';
import { Tooltip } from '../Tooltip';

const Demo = ({ label }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '6px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: '12px', cursor: 'default',
  }}>{label}</span>
);

export default {
  title: 'Cathode Design System / Tooltip',
  component: Tooltip,
  argTypes: {
    text: { control: 'text' },
    placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
  },
  tags: ['autodocs'],
};

export const Default = {
  args: { text: 'Generate code for your current Figma selection.', placement: 'top' },
  render: (args) => (
    <div style={{ padding: '40px 60px' }}>
      <Tooltip {...args}><Demo label="Hover me" /></Tooltip>
    </div>
  ),
};

export const Placements = {
  render: () => (
    <div style={{ display: 'flex', gap: 40, padding: '50px' }}>
      <Tooltip text="Top tooltip" placement="top"><Demo label="Top" /></Tooltip>
      <Tooltip text="Right tooltip" placement="right"><Demo label="Right" /></Tooltip>
      <Tooltip text="Bottom tooltip" placement="bottom"><Demo label="Bottom" /></Tooltip>
    </div>
  ),
};
