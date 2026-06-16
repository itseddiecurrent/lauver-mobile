module.exports = (api) => {
  // Jest sets NODE_ENV=test — use plain Babel presets for Node/Jest compatibility.
  // Metro (Expo dev server) uses babel-preset-expo which handles RN transforms.
  if (api.env('test')) {
    return {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    };
  }
  return {
    presets: ['babel-preset-expo'],
  };
};
