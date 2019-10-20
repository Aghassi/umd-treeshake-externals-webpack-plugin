const UMDExternalOptimizerPlugin = require('./UMDExternalOptimizerPlugin.js');
const ExternalPlugin = require('webpack/lib/ExternalsPlugin');

module.exports = {
    mode: 'development',
    entry: {
        App: './src/App.jsx',
    },
    module: {
        rules: [{
            test: /\.(js|mjs|jsx|ts|tsx)$/,
            exclude: /(node_modules|bower_components)/,
            use: {
                loader: 'babel-loader',
                options: {
                    presets: ['@babel/preset-env', '@babel/preset-react']
                }
            }
        }]
    },
    optimization: {
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    priority: -10
                },
                default: {
                    minChunks: 2,
                    priority: -20,
                    reuseExistingChunk: true
                }
            }
        }
    },
    plugins: [
        new ExternalPlugin('umd', [
            'react',
            'react-dom',
            'styled-components'
        ]),
        new UMDExternalOptimizerPlugin()
    ]
}