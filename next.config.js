/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      // Polling avoids EBUSY/file-lock issues on Windows/OneDrive.
      // RegExp ignore reduces Watchpack EINVAL noise when it walks up to C:\ and hits
      // protected paths (swapfile.sys, System Volume Information). Harmless if still logged.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: /node_modules|\.git|\.next|System Volume Information|[\\/](swapfile|pagefile|hiberfil)\.sys$|DumpStack\.log\.tmp$/,
        poll: 1000,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
