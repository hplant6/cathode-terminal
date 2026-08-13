import { Tabs } from '../Tabs';

export default {
  title: 'Cathode Design System / Tabs',
  component: Tabs,
  tags: ['autodocs'],
};

export const Default = {
  args: {
    tabs: [
      { value: 'wf', label: 'Working File' },
      { value: 'figma', label: 'Figma' },
      { value: 'sb', label: 'Storybook' },
    ],
    defaultValue: 'wf',
  },
};
