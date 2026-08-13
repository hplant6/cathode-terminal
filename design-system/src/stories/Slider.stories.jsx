import React from 'react';
import { Slider } from '../Slider';

export default {
  title: 'Cathode Design System / Slider',
  component: Slider,
  argTypes: {
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
    value: { control: { type: 'range', min: 0, max: 100 } },
    label: { control: 'text' },
    suffix: { control: 'text' },
    showValue: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  tags: ['autodocs'],
};

export const Default = { args: { defaultValue: 40, label: 'Opacity' } };

// The Budget Guard / AI Spend "session budget" control.
export const SessionBudget = { args: { min: 50, max: 95, step: 5, defaultValue: 80, label: 'Session budget', suffix: '%' } };

export const Disabled = { args: { defaultValue: 60, label: 'Locked', disabled: true } };

export const NoValue = { args: { defaultValue: 30, showValue: false, label: 'Volume' } };
