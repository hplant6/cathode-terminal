import React from 'react';
import { Alert } from '../Alert';

export default {
  title: 'Cathode Design System / Alert',
  component: Alert,
  argTypes: {
    variant: { control: 'select', options: ['info', 'success', 'warning', 'danger'] },
    title: { control: 'text' },
    action: { control: 'text' },
  },
  tags: ['autodocs'],
};

export const Info = { args: { variant: 'info', children: 'Restart the active session to pick up new connections.', action: 'Restart' } };
export const Success = { args: { variant: 'success', title: '✓', children: 'Added to Claude Code, Gemini CLI.' } };
export const Warning = { args: { variant: 'warning', children: 'Servers are configured but disabled in untrusted folders.' } };
export const Danger = { args: { variant: 'danger', title: 'Failed:', children: 'Could not reach the MCP server.' } };

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Alert variant="info" action="Restart">Restart the active session to pick up new connections.</Alert>
      <Alert variant="success" title="✓">Added to Claude Code, Gemini CLI.</Alert>
      <Alert variant="warning">Servers are configured but disabled in untrusted folders.</Alert>
      <Alert variant="danger" title="Failed:">Could not reach the MCP server.</Alert>
    </div>
  ),
};
