import React from 'react';
import { Input } from '../Input';

export default {
  title: 'Cathode Design System / Input',
  component: Input,
  tags: ['autodocs'],
};

export const Default        = { args: { label: 'API Key', placeholder: 'sk-ant-...' } };
export const WithHelp       = { args: { label: 'Storybook URL', placeholder: 'http://localhost:6006', helpText: 'Enter the URL of a running Storybook dev server' } };
export const WithError      = { args: { label: 'Folder Path', placeholder: '/path/to/storybook', error: 'Folder not found' } };
export const Disabled       = { args: { label: 'Read-only', defaultValue: 'connected', disabled: true } };
export const WithPrefix     = { args: { label: 'URL', prefix: 'https://', placeholder: 'app.example.com' } };
export const WithSuffix     = { args: { label: 'Port', placeholder: '6006', suffix: 'TCP' } };
export const Password       = { args: { label: 'Secret Key', type: 'password', placeholder: 'Enter secret...' } };
export const Dark           = { args: { label: 'Command', variant: 'dark', placeholder: 'e.g. claude', defaultValue: 'claude' } };   // address-bar style: shade-7 fill, shade-3 border
