import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.ITCH_BUILD === '1'
  ? { output: 'export' }
  : {};

export default nextConfig;
