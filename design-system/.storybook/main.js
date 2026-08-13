export default {
  stories: ['../src/**/*.stories.@(js|jsx)', '../src/**/*.mdx'],
  addons: [
    '@storybook/addon-essentials',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
};
