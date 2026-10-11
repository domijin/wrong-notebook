import type { NextConfig } from "next";

// 对公网开放时的基础安全响应头。完整 CSP 需要逐页验证（GeoGebra 从 geogebra.org 加载脚本，
// KaTeX 用内联样式），这里先只用 frame-ancestors 禁止被嵌入，防点击劫持。
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  // 浏览器只在 HTTPS 响应上认 HSTS，本地 http 开发不受影响
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  // Next 16 blocks dev assets from origins it does not recognise. Playwright
  // drives the app through http://127.0.0.1:3000, so without this the client
  // bundle is refused and React never hydrates: every spec then fails while
  // waiting to leave /login, which looks like an auth bug but is not one.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  poweredByHeader: false,
  // Behind Cloudflare (or any TLS-terminating proxy) a visitor who typed http:// reaches the app with
  // X-Forwarded-Proto: http. Send them to the same URL over HTTPS before a login form is ever served
  // in clear text. Requests without the header (local dev, tests) are untouched.
  async redirects() {
    return [{
      source: "/:path*",
      has: [
        { type: "header", key: "x-forwarded-proto", value: "http" },
        { type: "host", value: "(?<host>.+)" },
      ],
      destination: "https://:host/:path*",
      permanent: true,
    }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
