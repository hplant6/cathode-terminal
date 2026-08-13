import {
  PropertyCheckbox, PropertyDropdown, PropertyInput, PropertySlider, PropertyRow, Drawer,
} from '../BoxSelect';

export default {
  title: 'Cathode Design System / Box Select',
  parameters: { backgrounds: { default: 'dark' } },
  decorators: [(Story) => (
    <div style={{ background: 'var(--spec-toolbar-bg)', padding: 24, width: 460 }}><Story /></div>
  )],
};

export const Checkbox = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <PropertyCheckbox />
    <PropertyCheckbox defaultChecked />
  </div>
);

export const Dropdown = () => <PropertyDropdown value="Flex" />;

export const Input = () => <PropertyInput value="1234px" />;

export const Slider = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <PropertySlider />
    <PropertyInput value="1234px" />
  </div>
);

export const PropertyRows = () => (
  <div>
    <PropertyRow label="Display" control={<PropertyDropdown value="Flex" />} />
    <PropertyRow label="Wrap" selected control={<PropertyDropdown value="Nowrap" />} />
    <PropertyRow label="Direction" control={<><PropertySlider /><PropertyInput value="1234px" /></>} />
    <PropertyRow label="Gap" control={<PropertyInput value="normal" />} />
  </div>
);

export const ElementDrawer = () => (
  <Drawer descriptor="Container" name="K" count={2} open>
    <div style={{ padding: '11px 12px 7px', fontFamily: 'var(--font-title)', fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--spec-text-dim)' }}>Layout</div>
    <PropertyRow label="Display" control={<PropertyDropdown value="Flex" />} />
    <PropertyRow label="Wrap" selected control={<PropertyDropdown value="Nowrap" />} />
    <PropertyRow label="Gap" selected control={<PropertyInput value="normal" />} />
  </Drawer>
);

export const CollapsedDrawers = () => (
  <div>
    <Drawer descriptor="Container" name="K" count={2} />
    <Drawer descriptor="Text Input" name="input#email" count={0} />
    <Drawer descriptor="Heading" name="h1.hero" count={4} />
  </div>
);
