import React from 'react';
import { HeroHeader } from '../HeroHeader';

export default {
  title: 'Cathode Design System / Hero Header',
  component: HeroHeader,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    subHeading: { control: 'text' },
    headingPrefix: { control: 'text' },
    interval: { control: { type: 'number', min: 600, step: 100 } },
    align: { control: 'inline-radio', options: ['left', 'center', 'right'] },
  },
  tags: ['autodocs'],
};

export const Default = {
  args: {
    subHeading: 'Henry Plant, Senior Product Designer',
    headingPrefix: 'Mastering',
    align: 'center',
  },
};

export const LeftAligned = {
  name: 'Left Aligned',
  args: { ...Default.args, align: 'left' },
};

export const CustomWords = {
  name: 'Custom Words',
  args: {
    subHeading: 'Cathode Terminal',
    headingPrefix: 'Built for',
    words: ['developers', 'tinkerers', 'power users', 'the terminal'],
    align: 'center',
  },
};
