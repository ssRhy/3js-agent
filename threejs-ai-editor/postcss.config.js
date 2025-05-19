module.exports = {
  plugins: {
    "postcss-import": {},
    autoprefixer: {},
    "postcss-preset-env": {
      features: { "nesting-rules": false },
    },
  },
};
