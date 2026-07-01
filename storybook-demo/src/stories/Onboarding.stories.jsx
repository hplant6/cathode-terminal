import React from 'react';
import { Onboarding } from '../Onboarding';

export default {
  title: 'Cathode Design System / Onboarding',
  component: Onboarding,
  parameters: { layout: 'centered', backgrounds: { default: 'dark' } },
  tags: ['autodocs'],
};

// The real Claude-Code setup sequence (WSL/Node/CLI/adapter/auth) + a couple of
// verification steps, so the list reads like Hermes'.
const base = [
  { label: 'Verifying WSL 2 + Ubuntu' },
  { label: 'Verifying Node.js' },
  { label: 'Installing Claude Code CLI' },
  { label: 'Installing the ACP adapter' },
  { label: 'Detecting Git & ripgrep' },
  { label: 'Sign in to Claude', sub: 'Authenticate with your Anthropic account or an API key.' },
  { label: 'Writing config templates' },
];
const s = (i, state, extra = {}) => ({ ...base[i], state, ...extra });

export const ReadyToStart = {
  name: 'Ready to start',
  args: {
    primaryLabel: 'Set up automatically',
    steps: base.map((b) => ({ ...b, state: 'pending' })),
  },
};

export const InProgress = {
  name: 'In progress',
  args: {
    primaryLabel: 'Cancel',
    steps: [
      s(0, 'done', { time: '2.1s' }),
      s(1, 'done', { time: '318ms' }),
      s(2, 'done', { time: '6.4s' }),
      s(3, 'running'),
      s(4, 'pending'),
      s(5, 'pending'),
      s(6, 'pending'),
    ],
  },
};

export const NeedsSignIn = {
  name: 'Paused — sign in',
  args: {
    primaryLabel: 'Cancel',
    steps: [
      s(0, 'done', { time: '2.1s' }),
      s(1, 'done', { time: '318ms' }),
      s(2, 'done', { time: '6.4s' }),
      s(3, 'done', { time: '19.5s' }),
      s(4, 'done', { time: '1.2s' }),
      s(5, 'action', { actionLabel: 'Sign in' }),
      s(6, 'pending'),
    ],
  },
};

export const Complete = {
  args: {
    subtitle: 'Everything is installed and you’re signed in.',
    primaryLabel: 'Start using Cathode',
    steps: base.map((b, i) => ({ ...b, state: 'done', time: ['2.1s', '318ms', '6.4s', '19.5s', '1.2s', '—', '120ms'][i] })),
  },
};

export const DetailsExpanded = {
  name: 'Details expanded',
  args: {
    primaryLabel: 'Cancel',
    showDetails: true,
    detailLog:
      '$ npm install -g @anthropic-ai/claude-code\n\nadded 142 packages in 6s\n\n$ acp-adapter --version\n0.25.1\n',
    steps: [
      s(0, 'done', { time: '2.1s' }),
      s(1, 'done', { time: '318ms' }),
      s(2, 'running'),
      s(3, 'pending'),
      s(4, 'pending'),
      s(5, 'pending'),
      s(6, 'pending'),
    ],
  },
};
