/** @type {import('next').NextConfig} */
const nextConfig = {
    // Bundle size optimization
    compress: true,

    // Production optimizations
    swcMinify: true,

    // Remove unused code
    modularizeImports: {
        '@mui/icons-material': {
            transform: '@mui/icons-material/{{member}}',
        },
    },

    // Webpack bundle analyzer (enable with ANALYZE=true)
    webpack: (config, { isServer }) => {
        if (process.env.ANALYZE === 'true') {
            const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
            config.plugins.push(
                new BundleAnalyzerPlugin({
                    analyzerMode: 'static',
                    reportFilename: isServer
                        ? '../analyze/server.html'
                        : './analyze/client.html',
                })
            );
        }

        return config;
    },
};

module.exports = nextConfig;
