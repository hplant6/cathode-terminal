import React from 'react';
import { Card } from '../Card';

const GitIcon = (
  <svg viewBox="0 0 18 18" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="4" r="2" /><circle cx="5" cy="14" r="2" /><circle cx="13" cy="9" r="2" />
    <path d="M5 6v6" /><path d="M5 9h4a2 2 0 0 0 2-2V6" />
  </svg>
);

export default {
  title: 'Cathode Design System / Card',
  component: Card,
  argTypes: { title: { control: 'text' }, description: { control: 'text' }, selected: { control: 'boolean' } },
  tags: ['autodocs'],
};

export const Default = { args: { title: 'Pull down a repo', description: 'Clone a Git repo, install, and run it' } };
export const WithIcon = { args: { title: 'Pull down a repo', description: 'Clone a Git repo, install, and run it', icon: GitIcon } };
export const Selected = { args: { title: 'Start a dev server', description: 'Spin it up on a free localhost port', selected: true } };

export const Row = {
  name: 'Card Row',
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      <Card title="Pull down a repo" description="Clone a Git repo, install, and run it" icon={GitIcon} />
      <Card title="Start a dev server" description="Spin it up on a free localhost port" />
    </div>
  ),
};
