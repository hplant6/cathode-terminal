import { AddButton } from '../AddButton';

export default {
  title: 'Cathode Design System / Add Button',
  component: AddButton,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: 'Outlined add-row button for modals. Static: shade-2 border / shade-1 text / no fill. Hover: orange border / white text / no fill.' } },
  },
  decorators: [(Story) => (
    <div style={{ width: 460, padding: 16, background: 'var(--spec-structural)', borderRadius: 8 }}>
      <Story />
    </div>
  )],
};

export const AddPrompt = { args: { label: '+ Add Prompt' } };
export const AddProfile = { args: { label: '+ Add Profile' } };
export const AddKey = { args: { label: '+ Add Key' } };
