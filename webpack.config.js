module.exports = {
    mode: 'development',
    output: {
        libraryTarget: 'umd'
    },
    entry: {
        a: './src/entry_a.jsx',
        b: './src/entry_b.jsx'
    },
    externals: [
        'react',
        'react-dom'
    ],
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
    }
}