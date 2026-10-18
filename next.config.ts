import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a second screen of the table on this machine, under a host of its own so
  // that it keeps a profile of its own
  allowedDevOrigins: ["127.0.0.1", "192.168.178.58"],
};

export default nextConfig;
