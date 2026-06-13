import React from 'react';
import { IconButton } from '../IconButton';

const BoxIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <path d="m6.75,2h-2c-1.5166,0-2.75,1.2334-2.75,2.75v1.5c0,.4141.3359.75.75.75s.75-.3359.75-.75v-1.5c0-.6895.5605-1.25,1.25-1.25h2c.4141,0,.75-.3359.75-.75s-.3359-.75-.75-.75Z" />
    <path d="m16.5,3.5h-2V1.5c0-.4141-.3359-.75-.75-.75s-.75.3359-.75.75v2h-2c-.4141,0-.75.3359-.75.75s.3359.75.75.75h2v2c0,.4141.3359.75.75.75s.75-.3359.75-.75v-2h2c.4141,0,.75-.3359.75-.75s-.3359-.75-.75-.75Z" />
  </svg>
);

export default {
  title: 'Cathode Design System / IconButton',
  component: IconButton,
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline'] },
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  tags: ['autodocs'],
};

export const Default = { args: { icon: BoxIcon, label: 'Box select', variant: 'default' } };
export const Outline = { args: { icon: BoxIcon, label: 'Box select', variant: 'outline' } };
export const Active = { args: { icon: BoxIcon, label: 'Box select', variant: 'outline', active: true } };
export const Disabled = { args: { icon: BoxIcon, label: 'Box select', variant: 'outline', disabled: true } };

export const Toolbar = {
  render: () => (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', width: 'fit-content' }}>
      <IconButton icon={BoxIcon} label="Box" />
      <IconButton icon={BoxIcon} label="Lasso" active />
      <IconButton icon={BoxIcon} label="Resize" />
    </div>
  ),
};
