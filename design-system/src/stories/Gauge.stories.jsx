import React from 'react';
import { Gauge } from '../Gauge';

export default {
  title: 'Cathode Design System / Gauge',
  component: Gauge,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    label: { control: 'text' },
    sublabel: { control: 'text' },
  },
  tags: ['autodocs'],
};

export const ContextWindow = { args: { value: 71, label: 'Context window', sublabel: '142k / 200k tokens' } };
export const UsageLimit = { args: { value: 88, label: 'Usage limit', sublabel: 'Resets 8:10 AM', color: '#B32D2D' } };

export const Row = {
  name: 'Gauge Row',
  render: () => (
    <div style={{ display: 'flex', gap: 28 }}>
      <Gauge value={42} label="Context" sublabel="84k / 200k" />
      <Gauge value={88} label="This session" sublabel="Resets 8 AM" color="#B32D2D" />
      <Gauge value={94} label="This week" sublabel="Resets Jun 15" color="#B32D2D" />
    </div>
  ),
};
