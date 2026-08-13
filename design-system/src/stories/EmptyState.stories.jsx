import React from 'react';
import { EmptyState } from '../EmptyState';
import { Card } from '../Card';

const TargetIcon = (
  <svg viewBox="0 0 18 18" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="9" r="7.25" /><circle cx="9" cy="9" r="3.25" /><circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const GitIcon = (
  <svg viewBox="0 0 18 18" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="4" r="2" /><circle cx="5" cy="14" r="2" /><circle cx="13" cy="9" r="2" />
    <path d="M5 6v6" /><path d="M5 9h4a2 2 0 0 0 2-2V6" />
  </svg>
);

export default {
  title: 'Cathode Design System / EmptyState',
  component: EmptyState,
  argTypes: { title: { control: 'text' }, description: { control: 'text' } },
  tags: ['autodocs'],
};

export const Default = {
  args: {
    icon: TargetIcon,
    title: 'Target a project to work on',
    description: 'Point the Working File at a live site or a local dev server — then use the tools and your agent to inspect, edit, and iterate.',
  },
};

export const WithActions = {
  render: () => (
    <EmptyState
      icon={TargetIcon}
      title="Target a project to work on"
      description="Point the Working File at a live site or a local dev server, then iterate with your agent."
    >
      <div style={{ display: 'flex', gap: 10 }}>
        <Card title="Pull down a repo" description="Clone a Git repo, install, and run it" icon={GitIcon} />
        <Card title="Start a dev server" description="Spin it up on a free localhost port" />
      </div>
    </EmptyState>
  ),
};
