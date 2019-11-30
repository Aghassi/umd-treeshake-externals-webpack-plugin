# umd-treeshake-externals-webpack-plugin
A plugin to properly declare externals in all chunks in a webpack bundle

This plugin goes a step further than the default way of optimizing externals for UMD based compilation targets using Webpack. Instead of putting all the externals in the entry module, this attempts to move the externals down the file tree to the actual point of use relative to the original source code.

For example: If you have a chunk `a` that uses `styled-components`, that should not end up in your entry chunk `App` because `App` doesn't need `styled-components` yet. If the user never goes through something that triggers `a` to load, `styled-components` would never be loaded.

## Usage

1. Remove your `external` block in your `webpack.config.js` and instead import the `ExternalPlugin` from webpack.

```js
const ExternalPlugin = require('webpack/lib/ExternalPlugin');
```

2. Add the `ExternalPlugin` to your `plugins: []` array in your config file.

```js
plugins: [
    new ExternalPlugin('umd', /* externals object */ [])
]
```
Ensure the first parameter is `"umd"`, and the second parameter is your original externals object.

3. Add the `UMDExternalOptimizerPlugin` to your plugins

```js
const UMDExternalOptimizerPlugin = require('umd-external-optimizer-webpack-plugin');

plugins: [
    new ExternalPlugin('umd', /* externals object */ [])
    new UMDExternalOptimizerPlugin("", {})
]
```