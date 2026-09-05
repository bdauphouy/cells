import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the phone on the LAN load the dev server. Without this, Next 16's
  // dev-server CSRF guard 403s any request whose Origin isn't localhost, so
  // static chunks 403 silently and the client bundle never finishes booting.
  allowedDevOrigins: ["192.168.1.87"],
  turbopack: {
    rules: {
      "*.glsl": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
