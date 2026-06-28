import { SidebarTabs } from '../SidebarTabs';

export default {
  title: 'Cathode Design System / Sidebar Tabs',
  component: SidebarTabs,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: 'Vertical underline tabs (e.g. the theme selector). Geist Mono Black, all caps, no corner radius. Inactive: shade-1. Hover: shade-2 underline. Active: orange underline + check.' } },
  },
  decorators: [(Story) => (
    <div style={{ padding: 20, background: 'var(--spec-structural)', borderRadius: 8, width: 220 }}>
      <Story />
    </div>
  )],
};

export const ThemeSelector = { args: { tabs: ['Default', 'Khaki', 'Custom'], defaultActive: 0 } };
export const TwoTabs       = { args: { tabs: ['Presets', 'Custom'], defaultActive: 1 } };
