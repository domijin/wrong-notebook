import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  // Next 16 blocks dev assets from origins it does not recognise. Playwright
  // drives the app through http://127.0.0.1:3000, so without this the client
  // bundle is refused and React never hydrates: every spec then fails while
  // waiting to leave /login, which looks like an auth bug but is not one.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
